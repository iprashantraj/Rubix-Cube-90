import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApiQuery } from '../api/useApi';
import { ServerImage } from '../api/useDisplayImage';
import type { Me, Order, Product } from '../api/types';
import { useSession } from '../store';
import { t, bcp47 } from '../i18n/index';
import type { Lang } from '../i18n/index';
import { useVoice } from '../voice/useVoice';
import { Screen, BigButton, AccountButton } from '../ui/kit';
import { HomeSkeleton } from '../ui/LoadState';
import { todosFor } from './homeTodos.js';
import {
  IconCreate,
  IconForward,
  IconPhoto,
  IconOrders,
  IconMoney,
  IconAlert,
  IconSettings,
} from '../ui/icons';

/**
 * /home — where the app opens.
 *
 * It used to open straight into /camera, so the first thing a new artisan ever heard, before
 * touching anything, was "move into the light". Taking a photo is now something you decide
 * to do.
 *
 * This was also the one screen that composed its own chrome, which is exactly why the accent
 * header existed here and nowhere else. It is now `hero` on the shared <Screen> (kit.tsx),
 * and /products, /orders, /earnings and /settings wear the same one — so moving between tabs
 * no longer changes the shape of the app, and the white system clock stays legible on every
 * one of them instead of just this one.
 *
 * The products are shown as PICTURES, not as the numeral 4. An artisan recognises their own
 * saree instantly and cannot necessarily read the word next to it — and a screen about
 * their work should look like their work.
 *
 * ## What this screen answers, after the redesign
 *
 * It used to answer exactly one question — "how much of each thing do I have" — as three
 * totals on the accent, and then stop. A total is not an instruction: the screen could say
 * "2" beside the words "new orders" and give the artisan no way to do anything about it,
 * and the money total sat next to it saying nothing about whether that money had actually
 * landed. Everything actionable lived behind a tab an artisan had to think to open.
 *
 * So there are now three bands, in the order a person actually needs them:
 *
 *   1. the three totals, on the accent — the state of the business at a glance
 *   2. **what is waiting on you**, as tappable rows — the part that was missing
 *   3. your work, as photographs, now captioned with the one number about each product
 *      that an artisan wants and previously had to open a detail screen to see
 *
 * Band 2 is derived entirely from `/products`, `/orders` and `/me`, which this screen was
 * already fetching. It costs no new endpoint and nothing new for the backend to keep in
 * step — see the note on the queries below.
 */

/** List endpoints answer either a bare array or `{items}`; both shapes are in use. */
const list = <T,>(r: T[] | { items?: T[] } | null | undefined): T[] => Array.isArray(r) ? r : (r?.items ?? []);

/**
 * Rupees, as a numeral, for READING.
 *
 * 🐞 This is half of the overflow bug. The money fact rendered `money.rupees`, which is the
 * sentence "{amount} rupees" — so a 34px tile one third of the screen wide was being handed
 * "120000 rupees", roughly 250px of text, and asked not to wrap it. The other half of the
 * fix is in styles.css.
 *
 * `t('money.rupees')` is still exactly right for anything SPOKEN — a TTS voice reads the
 * word, not the glyph — and /earnings and /orders keep using it for that. What goes in a
 * narrow box is the numeral, grouped Indian-style (1,20,000, not 120,000) by the platform.
 * `bcp47(lang)` and not a hardcoded 'en-IN', so the grouping follows the artisan's locale.
 */
function rupees(lang: Lang, n: number): string {
  return n.toLocaleString(bcp47(lang), {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

export default function Home() {
  const nav = useNavigate();
  const { lang } = useVoice();
  const artisan = useSession((s) => s.artisan);
  const patchArtisan = useSession((s) => s.patchArtisan);

  /*
   * Both endpoints already exist and are already paid for by the tabs. A /home/summary
   * route would be a third thing to keep in step with them for no benefit at this size —
   * and it is what makes the "needs you" band below free: every count on it is a filter
   * over rows this screen already holds.
   *
   * The counts render from the last visit's copy on the frame this screen appears and
   * correct themselves a moment later if the server disagrees. /home used to be a spinner
   * every single time it was opened, for numbers that rarely change.
   */
  const { data: rawProducts, isPending: pp } = useApiQuery<Product[]>('/products');
  const { data: rawOrders, isPending: po } = useApiQuery<Order[]>('/orders');
  const products = rawProducts ? list(rawProducts) : null;
  const orders = rawOrders ? list(rawOrders) : null;
  const isPending = pp || po;

  /*
   * The greeting says the artisan's name, and the store's copy of it is only as fresh as
   * the last screen that wrote one. Sign in on a second phone, reinstall, or let a /me
   * PATCH land while the app is closed, and this screen greets someone it has known by
   * name for weeks as a stranger. The server knows; ask it — on a 30-minute TTL, so the
   * greeting is never what /home waits for.
   *
   * The readiness booleans on the same payload now also drive the setup row below. 🔒 They
   * are booleans by design: has_bank is true or false and the account number never enters
   * this app (spec §14.1), so this screen can say "add your bank details" without ever
   * being able to show them.
   */
  const { data: me } = useApiQuery<Me>('/me');
  useEffect(() => {
    if (me?.display_name) patchArtisan({ display_name: me.display_name, craft: me.craft });
  }, [me, patchArtisan]);

  const named = Boolean(artisan?.display_name);
  const promptKey = named ? 'home.greeting_named' : 'home.greeting';
  const promptVars = { name: artisan?.display_name };

  /*
   * 🐞 This counted `state === 'new'`, which is not one of the six order states — the
   * server emits `placed`, and Orders.tsx has always filtered on that. So the "new orders"
   * figure on the dashboard was ALWAYS ZERO, and the one number whose whole job is to say
   * "something needs you today" silently said "nothing does". Found by the TypeScript
   * conversion, which is the first thing in this codebase able to compare the string
   * against the union it is supposed to belong to.
   */
  const newOrders = (orders ?? []).filter((o) => o.state === 'placed').length;
  const owed = (orders ?? [])
    .filter((o) => o.payment_state === 'pending')
    .reduce((sum, o) => sum + (o.amount ?? 0), 0);

  /*
   * What is waiting on the artisan. The counting lives in homeTodos.js and not here, so it
   * can be run under bare `node` — every one of those counts has to agree exactly with the
   * tab it links to, and a dashboard that says "3 new orders" over a list of two is how the
   * number stops being believed. See the note at the top of that file.
   *
   * The icon is chosen here rather than there: homeTodos.js is pure data and has no
   * business importing React components.
   */
  const ICONS: Record<string, typeof IconOrders> = {
    orders: IconOrders,
    pay: IconMoney,
    colour: IconAlert,
    setup: IconSettings,
  };
  const todos = todosFor(products, orders, me) as {
    key: string;
    urgent: boolean;
    labelKey: string;
    subKey: string;
    count: number | null;
    to: string;
  }[];

  return (
    <Screen
      prompt={promptKey}
      promptVars={promptVars}
      hero
      // The app's only way into /settings — see AccountButton in kit.tsx.
      headLeft={<AccountButton />}
      /*
        Three facts on one line instead of three stacked rows. Stacked, they read as a
        settings list — the same shape as "Wi-Fi / Bluetooth / Display" — which is exactly
        what a home screen must not look like.

        They live in the hero rather than on the page because they are a summary of the
        heading, not the first item of content under it.
      */
      heroExtra={
        products &&
        orders && (
          <div className="facts">
            <Fact n={products.length} labelKey="home.stat_products" />
            <Fact n={newOrders} labelKey="home.stat_orders" tone={newOrders ? 'live' : null} />
            <Fact n={rupees(lang, owed)} labelKey="home.stat_money" />
          </div>
        )
      }
      /*
        The one action, pinned to the bottom where the thumb already is. It duplicates the
        centre button in the tab bar deliberately: the tab bar is chrome an artisan has to
        learn, and on first run there is nothing else on this screen to press.
      */
      footer={<BigButton icon={IconCreate} labelKey="home.add" onClick={() => nav('/camera')} />}
      state={isPending ? 'loading' : products?.length === 0 ? 'empty' : 'ready'}
      loadingLabel="common.loading"
      // The dashboard skeleton is the dashboard with its numbers removed, so the page does
      // not jump when they land — /home was a bare spinner every single time it opened.
      skeleton={<HomeSkeleton />}
      empty={{
        art: 'products',
        title: t(lang, 'products.empty'),
        body: t(lang, 'products.empty_help'),
      }}
    >
      {/*
        What is waiting on you, above your own work — because it is the only part of this
        screen with a deadline attached. A missed order is a cancelled order.

        Rendered only when there is something in it. An "all clear" card that is on screen
        every day is furniture, and furniture is what people stop reading; the absence of
        the band is itself the message.
      */}
      {todos.length > 0 && (
        <>
          <div className="home__sec">
            <span>{t(lang, 'home.todo')}</span>
          </div>
          {/*
            The rows are direct children of the body, NOT wrapped in a <Card>. `.chan`
            already carries its own border and shadow — it is a card — so a Card around
            them nests a card inside a card, and on a 360px screen the two sets of padding
            between them cost 74px of the row's width and wrapped "New orders" onto two
            lines. /publish renders these bare for the same reason.
          */}
          {todos.map((td) => {
            const Icon = ICONS[td.key];
            return (
            <button key={td.key} className="chan" onClick={() => nav(td.to)}>
              <span className={`todo__icon${td.urgent ? ' todo__icon--urgent' : ''}`}>
                <Icon size={20} aria-hidden />
              </span>
              <span className="chan__name">
                {t(lang, td.labelKey)}
                <span className="todo__sub">{t(lang, td.subKey)}</span>
              </span>
              {/*
                The count sits in its own slot rather than inside the sentence. "{n} new
                orders" needs a different plural form in Hindi and in Odia and we would get
                one of them wrong; a noun beside a numeral is correct in all three and
                reads faster besides.
              */}
              {td.count != null && <span className="todo__n">{td.count}</span>}
              <IconForward size={20} aria-hidden />
            </button>
            );
          })}
        </>
      )}

      {products && products.length > 0 && (
        <>
          <div className="home__sec">
            <span>{t(lang, 'home.recent')}</span>
            <button className="home__all" onClick={() => nav('/products')}>
              {t(lang, 'home.see_all')}
              <IconForward size={18} aria-hidden />
            </button>
          </div>
          <div className="home__shelf">
            {/* Four is what fits without scrolling on the shortest phone we target. The
                rest live behind "see all" rather than turning this into a second catalog. */}
            {products.slice(0, 4).map((p) => (
              <button key={p.id} className="shot" onClick={() => nav(`/products/${p.id}`)}>
                <span className="shot__img">
                  {p.image ? (
                    <ServerImage src={p.image} alt={p.title ?? ''} loading="lazy" />
                  ) : (
                    <span className="shot__none">
                      <IconPhoto size={34} aria-hidden />
                    </span>
                  )}
                  {/* 🔒 The publish gate, where the artisan can see it. An unconfirmed
                      colour is refused by every channel adapter, and the only place that
                      used to surface was the moment publishing failed.

                      aria-hidden, because the words below say the same thing — see
                      .shot__warn. A badge that is the ONLY marker breaks DESIGN.md §4. */}
                  {p.colour_confirmed === false && (
                    <span className="shot__flag" aria-hidden>
                      <IconAlert size={15} />
                    </span>
                  )}
                </span>
                <span className="shot__meta">
                  <span className="shot__title">{p.title || t(lang, 'home.untitled')}</span>
                  {/* An absent price is not a price. Rendering "No price yet" in the same
                      bold accent as ₹4,200 puts the two at the same weight, and the one that
                      is not a number should not read as loudly as the one that is. */}
                  {p.price != null ? (
                    <span className="shot__price">{rupees(lang, p.price)}</span>
                  ) : (
                    <span className="shot__price shot__price--none">
                      {t(lang, 'home.price_none')}
                    </span>
                  )}
                  {/* `home.flag_colour`, not `home.todo_colour`: same meaning, short enough
                      to survive a two-column tile beside an icon without ellipsing. */}
                  {p.colour_confirmed === false && (
                    <span className="shot__warn">
                      <IconAlert size={14} aria-hidden />
                      <span>{t(lang, 'home.flag_colour')}</span>
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

function Fact({ n, labelKey, tone }: { n: number | string; labelKey: string; tone?: string | null }) {
  const { lang } = useVoice();
  return (
    <div className={`fact${tone ? ` fact--${tone}` : ''}`}>
      <span className="fact__n">{n}</span>
      <span className="fact__l">{t(lang, labelKey)}</span>
    </div>
  );
}
