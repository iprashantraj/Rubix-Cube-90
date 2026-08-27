import { createElement, isValidElement, useRef, type ComponentType, type ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { stepOf, backOf } from './onboarding';
import { useVoice, useSpeakOnEnter } from '../voice/useVoice';
import { t, resolve, bcp47 } from '../i18n/index';
import type { Lang, Vars } from '../i18n/index';
import { useSession } from '../store';
import { LoadState } from './LoadState';
import { EmptyState, type EmptyArt } from './EmptyState';
import {
  IconReplay,
  IconYes,
  IconNo,
  IconMic,
  IconBack,
  IconHelp,
  IconHome,
  IconCreate,
  IconCatalog,
  IconOrders,
  IconMoney,
  IconStatusReady,
  IconStatusPending,
  IconStatusBlocked,
  IconStatusDone,
  IconStatusError,
  IconSettings,
} from './icons';

/**
 * The whole UI kit. Deliberately tiny.
 *
 * Design law (docs/Application-Architecture.md §3), enforced here rather than trusted:
 *   1. <= 3 tappable things per screen
 *   2. every screen speaks on entry
 *   3. nothing is typed except the OTP
 *   4. one problem shown at a time
 *
 * Minimal is not an aesthetic choice here. It is the accessibility requirement the PS
 * asks for, for a user who cannot read the label on the button.
 *
 * Visual language lives in styles.css: layered surfaces, ~20px radii, soft elevation.
 * Depth is doing a job — it groups things for someone who cannot read a heading — it is
 * not decoration, so keep it restrained.
 */

/**
 * Icons arrive as a lucide component (`icon={IconYes}`) or, rarely, as a ready-made
 * element when a caller needs to override colour or size. Accept both so no screen has to
 * think about which.
 *
 * `aria-hidden` because the icon is never the accessible name — the paired text label is,
 * always. An icon announced separately would just make every button read twice.
 */
/** A lucide component, or a ready-made element when a caller overrides colour or size. */
export type IconLike = ComponentType<LucideProps> | ReactNode;

function renderIcon(icon: IconLike | undefined, size: number) {
  if (!icon) return null;
  if (isValidElement(icon)) return icon;
  return createElement(icon as ComponentType<LucideProps>, {
    size,
    strokeWidth: 2.25,
    'aria-hidden': true,
  });
}

/**
 * Screen shell. `prompt` is spoken on entry and shown as the heading, so the same string
 * is always both heard and seen — they can never disagree.
 *
 * The accent band across the top is ON by default, and that default is the point.
 *
 * It started inside Home.jsx, which was the one screen composing its own chrome. The result
 * was that /home had a top and nothing else did: tapping "Products" in the tab bar went
 * from an app with a header to a heading floating on a grey page, and the system clock —
 * white icons, drawn by Android, not by us — went from legible on the accent to
 * white-on-grey, which is invisible. Same status bar, two different backgrounds, one tap
 * apart. It was then an opt-in prop, which reproduced the same split one layer down:
 * whoever remembered to pass it got a header, and onboarding and the whole create flow did
 * not.
 *
 * So it is the default. A screen has to argue its way OUT of being consistent, which is
 * the right way round. `hero={false}` exists for the dim erasure flow, where the whole
 * screen is deliberately stripped of everything but one decision.
 *
 * `heroExtra` is anything belonging ON the accent rather than on the page below it —
 * /home's three facts, and nothing else so far. A slot rather than a prop per fact,
 * because the next screen to want one will not want three numbers.
 */
export type ScreenProps = {
  prompt?: string | null;
  promptVars?: Vars;
  speak?: string;
  speakAlso?: string | string[];
  children?: ReactNode;
  footer?: ReactNode;
  back?: string | null;
  hero?: boolean;
  heroExtra?: ReactNode;
  headLeft?: ReactNode;
  onPromptSpoken?: () => void;
  speakOnEnter?: boolean;
  dim?: boolean;
  state?: 'ready' | 'loading' | 'empty';
  loadingLabel?: string | null;
  skeleton?: ReactNode;
  empty?: { art: EmptyArt; title?: string; body?: string };
};

export function Screen({
  prompt,
  promptVars,
  // What to SAY, when that is not what the heading says. /consent is the case that needs
  // it: the heading is "आपका डेटा" and the thing that has to be heard is the notice under
  // it. Speaking the title there announced a label and left the substance unplayed, which
  // for a notice we then store an artifact against is not good enough. Defaults to prompt.
  speak,
  speakAlso,
  children,
  footer,
  back,
  hero = true,
  heroExtra,
  /*
   * The top-left corner, when there is no back button.
   *
   * /home uses it for the account entry point, and that is the whole reason it exists:
   * /settings was a route with NOTHING in the app navigating to it. It was unreachable, and
   * so were /help, /channels and /wizard/gst behind it. A fifth tab would have cost the
   * camera its centre slot, so the account lives here instead — the same answer SplitFree
   * reached for the same reason.
   *
   * Back and headLeft are mutually exclusive by position: a screen deep enough to need
   * "back" is not a screen that should be offering a detour into settings.
   */
  headLeft,
  onPromptSpoken,
  // Speak on entry even though this is not a chain — for a screen whose CONTENT is the
  // point rather than its name. /consent is the case. Chains speak regardless; every other
  // destination stays quiet and offers the replay button.
  speakOnEnter = false,
  dim = false,
  /*
   * What the body is doing: 'ready' | 'loading' | 'empty'.
   *
   * Twelve screens had each grown their own version of this — a `Spinner` here, an
   * `items == null` ternary there, a bare line of grey text somewhere else — which is
   * exactly how the loaders drifted far enough apart to be worth a redesign. The states
   * are the same on every screen, so they belong to the container rather than to each
   * screen's judgement.
   *
   * `children` is therefore only ever the READY body. A screen no longer decides how it
   * waits, and cannot invent a fourth way of doing it.
   */
  state = 'ready',
  /** i18n key naming what is being waited FOR — "loading your products", not "loading". */
  loadingLabel,
  /** Page-shaped skeleton. Defaults to a list, which is what most of these screens are. */
  skeleton,
  /**
   * `{ art, title, body }` — see ui/EmptyState.tsx.
   *
   * ⚠️ `title` has to be the same sentence `prompt` resolves to. The prompt is what gets
   * SPOKEN and this is what gets SHOWN, and an artisan who hears one thing and sees
   * another has no way to tell which one the app meant.
   */
  empty,
}: ScreenProps) {
  const { lang } = useVoice();
  const { pathname } = useLocation();
  // `onPromptSpoken` fires when the question has finished playing. /catalog/voice uses it
  // to open the microphone by itself, so the artisan only ever has to answer.
  useSpeakOnEnter(speak ?? prompt, promptVars, speakAlso, onPromptSpoken, speakOnEnter);

  // resolve(), not t(): the heading and the replay button must agree with each other AND
  // with the voice about which language this string is actually in. A key missing from
  // Odia renders English here, and replaying it in an Odia voice is the bug resolve()
  // exists to stop.
  const head = prompt ? resolve(lang, prompt, promptVars) : null;

  /*
   * A sequence gets different chrome from a destination, because it answers a different
   * question.
   *
   * On a destination the top says WHERE YOU ARE. Part-way through a chain nobody cares —
   * they want to know how much is left, doubly so for someone who cannot read the question
   * and is trusting the app to be nearly done. So the header becomes a progress bar and the
   * question moves down into the page (`.ask`), where it reads as something being asked of
   * you rather than as the name of the screen.
   *
   * Both `steps` and `back` are derived from ui/onboarding.js rather than passed in, which
   * is what makes them impossible to forget — see the comment on that file.
   */
  const steps = stepOf(pathname);
  const backTo = back ?? backOf(pathname);

  // `dim` takes the whole screen for one irreversible decision and strips everything else
  // out of view. An accent band across the top of that is exactly the surrounding context
  // the variant exists to remove, so the two are mutually exclusive by construction rather
  // than by every caller remembering to pass `hero={false}`.
  const showHero = hero && !dim;

  return (
    <div className={`screen${showHero ? ' screen--hero' : ''}${dim ? ' screen--dim' : ''}`}>
      {(head || backTo || heroExtra || steps) && (
        <header className={showHero ? 'screen__hero' : 'screen__head'}>
          {/* Back, title-or-progress, replay — one row, in that order, on every screen.
              The row is its own element so a hero can stack a second one under it. */}
          <div className="screen__headRow">
            {backTo ? <BackButton to={backTo} /> : headLeft}
            {steps ? (
              <Steps {...steps} />
            ) : (
              head && <h1 lang={bcp47(head.lang)}>{head.text}</h1>
            )}
            {head && <ReplayButton text={head.text} textLang={head.lang} />}
          </div>
          {showHero && heroExtra}
        </header>
      )}
      <main className="screen__body">
        {/* The question, as a question. Big, centred, in the canvas with the answer rather
            than shrunk into the title slot above the chrome. */}
        {steps && head && (
          <p className="ask" lang={bcp47(head.lang)}>
            {head.text}
          </p>
        )}
        {/*
          One place decides what a waiting or empty screen looks like.

          `empty` falls back to the resolved prompt for its title, so the common case needs
          no second string and the shown sentence cannot drift from the spoken one.
        */}
        {state === 'loading' ? (
          <LoadState label={loadingLabel}>{skeleton}</LoadState>
        ) : state === 'empty' && empty ? (
          <EmptyState {...empty} title={empty.title ?? head?.text ?? ''} />
        ) : (
          children
        )}
      </main>
      {footer && <footer className="screen__foot">{footer}</footer>}
    </div>
  );
}

/**
 * How far through onboarding you are, as filled segments.
 *
 * Segments rather than a continuous bar, and no "3 of 5" anywhere: a count is a numeral,
 * a numeral is reading, and the whole premise of this app is that we cannot rely on that.
 * Five discrete blocks can be counted at a glance by someone who cannot read any of them,
 * and the number remaining is directly visible instead of inferred from a percentage.
 *
 * The current segment grows into place rather than appearing, so the transition itself
 * carries the message — something just finished, and there are this many left. The blanket
 * reduced-motion rule at the bottom of styles.css lands it on the filled state instantly,
 * which is still correct because the fill, not the animation, is the information.
 */
export function Steps({ step, total }: { step: number; total: number }) {
  return (
    <div
      className="steps"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={total}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`steps__seg${i < step ? ' steps__seg--on' : ''}${
            i === step - 1 ? ' steps__seg--now' : ''
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Go back one step.
 *
 * Every screen after /lang needs this and none of them had it. A first-time phone user who
 * picks the wrong language on screen one — which is the single easiest mistake to make in
 * this app, because the tiles are in scripts they may not read — had no way back. The
 * hardware gesture was not handled either (see App.jsx), so on a stock Android that either
 * did nothing or closed the app outright.
 *
 * `to` is either a path or `true` for "one step back in history". Prefer a path on the
 * onboarding chain: history there can contain a redirect the Guard performed, and popping
 * into one lands you straight back where you started.
 *
 * Left-hand side, always, because that is where every other Android app puts it — this is
 * one of the few conventions our users will already have absorbed from WhatsApp.
 */
export function BackButton({ to }: { to?: string | null }) {
  const nav = useNavigate();
  return (
    <button
      className="back"
      onClick={() => (typeof to === 'string' ? nav(to) : nav(-1))}
      aria-label="back"
    >
      {renderIcon(IconBack, 24)}
    </button>
  );
}

/**
 * Replay the prompt. Present on every screen — hearing it once is often not enough.
 *
 * The only icon-only control we allow. It earns the exemption by being in the same place
 * on every single screen (learned once, never re-read) and by carrying an aria-label.
 *
 * `textLang` is the language the text is written in, which is NOT always the language the
 * artisan picked — see resolve(). Without it, replay speaks a fallback English string in
 * an Odia voice, which is how this bug reached a real phone.
 */
export function ReplayButton({ text, textLang }: { text: string; textLang?: Lang }) {
  const { sayRaw } = useVoice();
  return (
    <button className="replay" onClick={() => sayRaw(text, textLang)} aria-label="replay">
      {renderIcon(IconReplay, 24)}
    </button>
  );
}

/**
 * The primary action. One per screen, always.
 * Icon and text are always paired — we never rely on text alone (spec §4.6).
 */
export function BigButton({
  icon,
  labelKey,
  label,
  onClick,
  disabled,
  tone = 'primary',
}: {
  icon?: IconLike;
  /** i18n key. Either this or `label`, never both. */
  labelKey?: string;
  label?: string;
  onClick?: () => void | Promise<void>;
  disabled?: boolean;
  tone?: 'primary' | 'yes' | 'no';
}) {
  const { lang } = useVoice();
  return (
    <button
      className={`big big--${tone}`}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
    >
      {icon && <span className="big__icon">{renderIcon(icon, 24)}</span>}
      <span className="big__label">{label ?? (labelKey ? t(lang, labelKey) : '')}</span>
    </button>
  );
}

/**
 * Yes / no. The single most common interaction in the app — the four readiness questions,
 * the colour lock, every confirmation.
 */
export function YesNo({ onYes, onNo, disabled }: { onYes: () => void; onNo: () => void; disabled?: boolean }) {
  return (
    <div className="yesno">
      <BigButton
        icon={IconYes}
        labelKey="common.yes"
        onClick={onYes}
        disabled={disabled}
        tone="yes"
      />
      <BigButton icon={IconNo} labelKey="common.no" onClick={onNo} disabled={disabled} tone="no" />
    </div>
  );
}

/**
 * The microphone. THE control of this app, and for a long time the only one with no
 * visible state at all — screens said "मैं सुन रहा हूँ" out loud and then showed a generic
 * loading spinner, which is the same thing they show while saving a name. An artisan who
 * cannot read had no way to tell a live mic from a dead one, and no way to tell either of
 * them from the app having hung.
 *
 * Three states, distinguishable at arm's length in sunlight without reading a word:
 *
 *   idle       accent circle, mic glyph. A target, obviously pressable, nothing moving.
 *   listening  turns bright --green, grows a static ring PLUS an expanding one, and an
 *              equaliser appears underneath. Four simultaneous changes — colour, ring,
 *              size, and a new object on screen — because any one of them alone dies on a
 *              washed-out cracked panel.
 *   thinking   drops to grey, mic dims, the ring becomes a turning arc. Deliberately the
 *              quietest of the three: nothing is expected of the user here.
 *
 * The animation is time-based, not amplitude-based. Real levels would mean an AnalyserNode
 * on the MediaStream, and record() (voice/listen.js) owns that stream and hands back only
 * stop/cancel — plumbing a second reference out of it, or opening a second getUserMedia
 * just to watch it, buys a nicer wave at the cost of two owners for one microphone. The
 * static ring + colour + equaliser already answer "is this thing on?"; levels would only
 * answer "how loud am I", which nothing in the flow asks.
 *
 * Reduced motion: everything that moves is a separate element (.mic__ping) or a transform
 * on top of a fully-styled resting state, so when the blanket rule at the bottom of
 * styles.css freezes it all, listening is still green + ringed + equalised. Never rely on
 * an animation to carry a state.
 */
const MIC_LABEL = {
  idle: 'voice.tap_to_speak',
  listening: 'voice.listening',
  thinking: 'voice.thinking',
};

export function MicButton({
  state = 'idle',
  onClick,
}: {
  state?: 'idle' | 'listening' | 'thinking';
  onClick: () => void;
}) {
  const { lang } = useVoice();
  const label = t(lang, MIC_LABEL[state] ?? MIC_LABEL.idle);

  /*
   * Every caller does `await say('ab boliye')` and only then opens the microphone, so there
   * is a beat of about a second after the tap where the handler is running but the state
   * prop has not moved yet. The button still looks idle, and an artisan who has just been
   * told to press it presses it again — which starts a second getUserMedia stream that
   * nobody holds a handle to and nobody ever stops. The recording light stays on after they
   * leave the screen.
   *
   * Guarded here rather than in each screen because all four of them have the same gap for
   * the same reason, and the fifth voice screen someone adds next month will too.
   */
  const busy = useRef(false);

  async function press() {
    if (busy.current) return;
    busy.current = true;
    try {
      await onClick?.();
    } finally {
      busy.current = false;
    }
  }

  return (
    <div className={`mic mic--${state}`}>
      <button
        className="mic__btn"
        onClick={press}
        disabled={state === 'thinking'}
        aria-label={label}
      >
        {/* Two rings, not one. The halo is the state; the ping is the decoration. */}
        <span className="mic__halo" aria-hidden="true" />
        <span className="mic__ping" aria-hidden="true" />
        <span className="mic__glyph">{renderIcon(IconMic, 44)}</span>
      </button>
      <span className="mic__bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      {/* Icon and text are always paired (design law). The hint only exists while
          listening, because "tap to finish" is meaningless in the other two states. */}
      <p className="mic__label">{label}</p>
      {state === 'listening' && <p className="mic__hint">{t(lang, 'voice.stop')}</p>}
    </div>
  );
}

/**
 * What we heard, shown back faintly under the microphone.
 *
 * Speaking into a phone that shows nothing is the single most anxious moment in this app.
 * The artisan has no idea whether the words arrived, whether the accent was understood, or
 * whether the six digits they just said were the six digits we got — so they say it again,
 * louder, which is usually worse.
 *
 * ⚠️ This appears AFTER the recording stops, not during it, and the distinction is not
 * cosmetic. Recognition runs on the server (voice/listen.js — never on-device, because
 * transcript quality must not depend on what phone somebody could afford), so there is no
 * partial transcript to stream. Anything that looked like live dictation here would be an
 * animation pretending to be a microphone. What this does honestly is close the loop the
 * moment there is something true to show.
 *
 * Faint on purpose: it is evidence, not content. The decision being asked for is still the
 * confirmation below it, and a full-contrast block of text here competes with the thing we
 * actually want pressed. `lang` is set so the screen reader and the font stack both get the
 * script right — a transcript is the one string on screen guaranteed to be in the
 * artisan's own language.
 */
export function Heard({ text, lang }: { text: string; lang: Lang }) {
  if (!text) return null;
  return (
    <p className="heard" lang={lang ? bcp47(lang) : undefined}>
      <span className="heard__quiet">“</span>
      {text}
      <span className="heard__quiet">”</span>
    </p>
  );
}

/** A tappable tile. Used for language, craft type, and anything else picked from a grid. */
export function Tile({
  icon,
  label,
  selected,
  onClick,
}: {
  icon?: IconLike;
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tile${selected ? ' tile--on' : ''}`}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="tile__icon">{renderIcon(icon, 34)}</span>
      <span className="tile__label">{label}</span>
    </button>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className="grid">{children}</div>;
}

/**
 * A plain surface that says "this is one thing". Grouping without a heading and without a
 * rule line — a user who cannot read gets nothing from either.
 */
export function Card({ children, raised = false }: { children: ReactNode; raised?: boolean }) {
  return <div className={`card${raised ? ' card--raised' : ''}`}>{children}</div>;
}

/**
 * A small status label. Colour AND a word, never colour alone.
 * `tone`: ready | pending | blocked | done | error.
 */
export function Chip({ tone = 'blocked', children }: { tone?: string; children: ReactNode }) {
  return (
    <span className={`chip chip--${tone}`}>
      <span className="chip__icon">{renderIcon(DOTS[tone as keyof typeof DOTS] ?? IconStatusBlocked, 15)}</span>
      {children}
    </span>
  );
}

/**
 * ready | pending | blocked | done | error — a distinct SHAPE per state, with colour on
 * top of it, never colour on its own.
 *
 * Was emoji (🟢🟡⚪✅🔴). Emoji lost us the shape distinction entirely — 🟢 and 🟡 are the
 * same circle in two hues, which is nothing at all to a colour-blind artisan — and they
 * render as three different glyph sets across Samsung, Xiaomi and stock Android.
 */
const DOTS = {
  ready: IconStatusReady,
  pending: IconStatusPending,
  blocked: IconStatusBlocked,
  done: IconStatusDone,
  error: IconStatusError,
};
export function StatusDot({ status }: { status: string }) {
  const known = (status in DOTS ? status : 'blocked') as keyof typeof DOTS;
  return (
    <span className={`dot dot--${known}`} role="img" aria-label={known}>
      {renderIcon(DOTS[known], 18)}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner">
      <div className="spinner__ring" />
      {label && <p>{label}</p>}
    </div>
  );
}

/**
 * Bottom navigation. Hidden during the create flow — mid-capture is not a moment to offer
 * someone an escape hatch into their earnings screen.
 *
 * Home sits on the left and the camera is the raised button in the middle. That layout is
 * doing two jobs:
 *
 *   1. The app no longer opens the lens on launch. It used to boot straight into /camera,
 *      so the first thing a new artisan ever heard was "move into the light" — the tool
 *      talking at them before they had touched anything. Taking a photo is now a thing you
 *      decide to do.
 *   2. It is where WhatsApp, Instagram and every other camera app on their phone put it.
 *      Our users have very little transferable phone literacy; where it exists, spend it.
 *
 * The centre slot is rendered outside the even grid so it can lift above the bar. Its label
 * still sits under it — icon and text are always paired (spec §4.6), and "the big round one
 * in the middle" is not a label.
 */
const TABS_LEFT = [
  { to: '/home', icon: IconHome, key: 'nav.home' },
  { to: '/products', icon: IconCatalog, key: 'nav.catalog' },
];
const TABS_RIGHT = [
  { to: '/orders', icon: IconOrders, key: 'nav.orders' },
  { to: '/earnings', icon: IconMoney, key: 'nav.money' },
];

function Tab({
  tab,
  active,
  onClick,
}: {
  tab: { to: string; icon: IconLike; key: string };
  active: boolean;
  onClick: () => void;
}) {
  const lang = useSession((s) => s.lang) ?? 'hi';
  return (
    <button
      className={`tabs__item${active ? ' tabs__item--on' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="tabs__icon">{renderIcon(tab.icon, 24)}</span>
      <span className="tabs__label">{t(lang, tab.key)}</span>
    </button>
  );
}

export function BottomNav({ active }: { active: string }) {
  const nav = useNavigate();
  const lang = useSession((s) => s.lang) ?? 'hi';
  return (
    <nav className="tabs">
      {TABS_LEFT.map((tab) => (
        <Tab key={tab.to} tab={tab} active={active === tab.to} onClick={() => nav(tab.to)} />
      ))}

      <button
        className={`tabs__shoot${active === '/camera' ? ' tabs__shoot--on' : ''}`}
        onClick={() => nav('/camera')}
        aria-current={active === '/camera' ? 'page' : undefined}
      >
        <span className="tabs__shootIcon">{renderIcon(IconCreate, 32)}</span>
        <span className="tabs__label">{t(lang, 'nav.create')}</span>
      </button>

      {TABS_RIGHT.map((tab) => (
        <Tab key={tab.to} tab={tab} active={active === tab.to} onClick={() => nav(tab.to)} />
      ))}
    </nav>
  );
}

/**
 * The account entry point, for /home's top-left corner.
 *
 * 🔎 This is the fix for a route that existed and could not be reached. Nothing in the app
 * navigated to /settings — no tab, no button, no link — so the DPDP erasure right, the
 * language picker, the theme picker and (through it) /help, /channels and /wizard/gst were
 * all live code with no way in. It is one of the few genuinely icon-only controls in the
 * app, which it earns the same way the replay button does: a fixed position, learned once,
 * plus an aria-label.
 */
export function AccountButton() {
  const nav = useNavigate();
  const lang = useSession((s) => s.lang) ?? 'hi';
  return (
    <button className="back" onClick={() => nav('/settings')} aria-label={t(lang, 'settings.title')}>
      {renderIcon(IconSettings, 24)}
    </button>
  );
}

/**
 * Help. Reachable from everywhere, routes to a remote callback from a cluster
 * coordinator — remote support, never a field visit (spec §2, hard NO #1).
 */
export function HelpButton() {
  const nav = useNavigate();
  const lang = useSession((s) => s.lang) ?? 'hi';
  return (
    <button className="help" onClick={() => nav('/help')}>
      {renderIcon(IconHelp, 18)}
      <span>{t(lang, 'help.button')}</span>
    </button>
  );
}
