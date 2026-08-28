import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { record, transcribe, type RecHandle } from '../voice/listen';
import { interpretChoice } from '../voice/interpret';
import { t } from '../i18n/index';
import { Screen, Grid, Tile, BigButton, YesNo, MicButton, Heard } from '../ui/kit';
import {
  IconMic,
  IconRetry,
  IconCraftWeaving,
  IconCraftPottery,
  IconCraftMetalwork,
  IconCraftWoodwork,
  IconCraftPainting,
  IconCraftJewellery,
  IconCraftLeather,
  IconCraftBamboo,
} from '../ui/icons';

/**
 * /onboard/craft — "Aap kya banate hain?" → 8-icon grid + a "kuch aur" voice option.
 *
 * The eight are the craft families the PS clusters actually fall into, not an exhaustive
 * taxonomy. Anything outside them goes through voice, which is why the ninth option
 * exists at all — a grid that cannot express your own trade is worse than no grid.
 *
 * `craft` is stored as the stable English slug, never the translated label — the label is
 * a display string that changes with language, and the category mapping downstream keys
 * off the slug.
 */
const CRAFTS = [
  { slug: 'weaving', icon: IconCraftWeaving, key: 'craft.weaving' },
  { slug: 'pottery', icon: IconCraftPottery, key: 'craft.pottery' },
  { slug: 'metalwork', icon: IconCraftMetalwork, key: 'craft.metalwork' },
  { slug: 'woodwork', icon: IconCraftWoodwork, key: 'craft.woodwork' },
  { slug: 'painting', icon: IconCraftPainting, key: 'craft.painting' },
  { slug: 'jewellery', icon: IconCraftJewellery, key: 'craft.jewellery' },
  { slug: 'leather', icon: IconCraftLeather, key: 'craft.leather' },
  { slug: 'bamboo', icon: IconCraftBamboo, key: 'craft.bamboo' },
];

export default function OnboardCraft() {
  const nav = useNavigate();
  const { lang, say } = useVoice();
  const patchArtisan = useSession((s) => s.patchArtisan);

  // pick -> (tile) save -> /onboard/place
  //      -> rec -> busy -> confirm -> save
  //                          └-> back to pick (the grid IS the fallback)
  const [phase, setPhase] = useState('pick');
  // `heard` is what we read back, in their language. `matched` is the slug we actually
  // save. They are two different things and conflating them is what put a Hindi sentence
  // into the craft field.
  const [heard, setHeard] = useState('');
  const [matched, setMatched] = useState<string | null>(null);
  // Their actual words. Kept separately from `heard` because this screen INTERPRETS —
  // what we decided they meant and what they said are two different claims, and only
  // one of them is evidence.
  const [rawHeard, setRawHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<RecHandle | null>(null);

  function fail(e: unknown, fallbackKey: string) {
    const key = e instanceof ApiError ? e.messageKey : null;
    setError(key ?? fallbackKey);
    say(key ?? fallbackKey);
  }

  async function save(craft: string) {
    setError(null);
    // See OnboardName.save(): 'busy' re-asked the question while the answer was being
    // saved, so the artisan was asked what they make immediately after telling us.
    setPhase('saving');
    try {
      await api.patch('/me', { craft });
      patchArtisan({ craft });
      nav('/onboard/place');
    } catch (e) {
      // Straight back to the grid. Their pick is one tap away from being made again, and
      // an error screen with no way forward is the one thing we never ship.
      setPhase('pick');
      fail(e, 'net.offline');
    }
  }

  async function startRec() {
    setError(null);
    try {
      // Mic FIRST, state second. record() resolves only once it is genuinely capturing
      // and sounds a short tone at that exact moment (voice/listen.js), so "listening" is
      // true from the frame it appears. This used to `await say('voice.listening')` first,
      // which announced the microphone about a second before opening it and swallowed
      // whatever the artisan said in reply to the question.
      recRef.current = await record({ onSilence: stopRec });
      setPhase('rec');
    } catch (e) {
      setPhase('pick');
      fail(e, 'voice.mic_denied');
    }
  }

  async function stopRec() {
    const handle = recRef.current;
    recRef.current = null;
    if (!handle) return;
    setPhase('busy');
    try {
      const { transcript } = await transcribe(await handle.stop(), lang);

      /*
       * What they SAID is not the answer — it contains the answer.
       *
       * This used to be `transcript.trim()` stored straight into `craft`, so anybody who
       * replied like a person ("मैं साड़ी बुनता हूँ") wrote a whole sentence into a field
       * that the category mapping, the pricing comparables and every channel adapter read
       * as a stable slug. It was only ever correct for someone who answered with a single
       * bare noun, which is not how anyone speaks. See voice/interpret.js.
       */
      const { slug, raw } = await interpretChoice({
        transcript,
        question: 'onboard.craft',
        options: CRAFTS.map((c) => c.slug),
        lang,
      });

      if (!raw) {
        setPhase('pick');
        return fail(new Error('empty'), 'voice.not_heard');
      }
      if (!slug) {
        // Heard them perfectly well, could not place it in a craft. A different failure
        // from silence and from ASR being down, so it says a different thing. Back to the
        // grid, which is the primary path on this screen precisely because of this case.
        setPhase('pick');
        return fail(new Error('unmatched'), 'onboard.craft_unclear');
      }
      // What gets confirmed is the craft in THEIR language, not the slug — "weaving" is
      // not a word we have any business reading back to someone who answered in Odia.
      setHeard(t(lang, CRAFTS.find((c) => c.slug === slug)!.key));
      setMatched(slug);
      setRawHeard(raw);
      setPhase('confirm');
    } catch (e) {
      // ASR is 503 in dev until Bhashini is keyed. This screen degrades better than any
      // other in the flow: the eight tiles are already the primary path, so we say what
      // failed and put them back in front of the grid. Nobody is stuck.
      setPhase('pick');
      fail(e, 'voice.unavailable');
    }
  }

  /*
   * 🐞 Tapping a tile used to render the confirmation screen, empty.
   *
   * `save()` sets phase to 'saving', and this read `phase === 'confirm' || phase ===
   * 'saving'` — so a tile tap, which never sets `heard`, showed "Did I hear ?" with a
   * blank where the craft should be, plus a yes/no about nothing. The artisan had just
   * pointed at a picture of a loom; there was nothing to confirm and we asked anyway.
   *
   * 'saving' is in here at all so the confirmation does not flicker away while the PATCH
   * is in flight after a VOICE answer. That only applies when something was heard, so
   * that is the condition.
   */
  const confirming = phase === 'confirm' || (phase === 'saving' && Boolean(heard));

  return (
    <Screen
      prompt={confirming ? 'onboard.craft_confirm' : 'onboard.craft'}
      promptVars={{ craft: heard }}
    >
      {error && <p className="warn">{t(lang, error)}</p>}

      {phase === 'pick' && (
        <>
          {/*
            Design law rule 1 says <= 3 tappable things. A grid of eight same-kind choices
            counts as one control, not eight — exactly as /lang does. The rule is about how
            many DECISIONS a screen asks for, and this screen asks for one.
          */}
          <Grid>
            {CRAFTS.map((c) => (
              <Tile key={c.slug} icon={c.icon} label={t(lang, c.key)} onClick={() => save(c.slug)} />
            ))}
          </Grid>
          <BigButton icon={IconMic} labelKey="onboard.craft_other" onClick={startRec} tone="no" />
        </>
      )}

      {/* The grid is the primary path here, so 'pick' keeps its quiet "kuch aur" button
          above; once the mic is actually open it is the same component as everywhere
          else. Tapping the live mic is what stops it. */}
      {(phase === 'rec' || phase === 'busy') && (
        <MicButton
          state={phase === 'rec' ? 'listening' : 'thinking'}
          onClick={phase === 'rec' ? stopRec : () => {}}
        />
      )}

      {confirming && (
        <>
          <p style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>{heard}</p>
          {/* What they actually said, faint, under what we made of it. On a screen that
              interprets, showing only the interpretation asks someone to confirm a
              decision they cannot check. */}
          <Heard text={rawHeard} lang={lang} />
          {/* "No" goes back to the grid rather than straight to the mic: if ASR heard them
              wrong once it will probably do it again, and a tile always works. */}
          <YesNo onYes={() => save(matched!)} onNo={() => setPhase('pick')} />
          <BigButton icon={IconRetry} labelKey="common.retry" onClick={startRec} tone="no" />
        </>
      )}
    </Screen>
  );
}
