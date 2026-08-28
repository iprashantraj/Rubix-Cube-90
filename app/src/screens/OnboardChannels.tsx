import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useSession } from '../store';
import { useVoice } from '../voice/useVoice';
import { t } from '../i18n/index';
import { Screen, Grid, Tile, BigButton } from '../ui/kit';
import {
  IconYes,
  IconRetry,
  IconChannelAmazon,
  IconChannelFlipkart,
  IconChannelMeesho,
  IconChannelGeM,
  IconChannelWhatsApp,
} from '../ui/icons';

/**
 * /onboard/channels — "do you already sell anywhere else?"
 *
 * Asked once, and it is the highest-leverage question in the whole app, because it is the
 * only one whose answer REMOVES other questions.
 *
 * `plan()` in catalog/slots.js asks for a slot only when some channel we are publishing to
 * needs it. Shipping weight is wanted by Amazon, Flipkart, GeM and Meesho and by nobody
 * else; a tape-measured size is wanted by five of the seven. So an artisan who sells only
 * on WhatsApp, or nowhere yet, should never be asked for either — and before this screen
 * existed, every one of them was, on every product, forever.
 *
 * ── Multi-select, and therefore not the yes/no shape used by /onboard/ready ──────────
 * Design law rule 4 says one question per screen, and this is one question: "which of
 * these do you use". Four sequential yes/no screens would be four questions to save
 * questions, which is a bad trade and an obviously silly one.
 *
 * ── "None of these" is a real answer and is the loud one ─────────────────────────────
 * It is also the true answer for most of the people this app exists for, so it is a full
 * button rather than a quiet link. Nobody should have to work out that "select nothing,
 * then press done" is how you say "I do not sell anywhere".
 *
 * ── Four different shapes, not four copies of one ───────────────────────────────────
 * The craft grid works because eight different drawings mean eight different things. This
 * grid shipped with one generic mark repeated four times, which left the text label doing
 * all the work for the exact users who cannot read it. Each tile now carries its own glyph
 * — a globe, a bag, a shop, a chat bubble — chosen for what the platform IS to an artisan
 * rather than for what its logo looks like. See the note in ui/icons.tsx about why these
 * are not the real brand marks.
 *
 * ⚠️ This records what they SAY they have, not what we can push to. Connecting an account
 * is OAuth and lives on /channels; this only decides what to ask and what to show. Someone
 * with an Amazon account they have not connected gets a Connect button on /publish.
 * Someone who has never heard of Amazon is shown nothing about it at all.
 */
const CHANNELS = [
  { id: 'amazon', icon: IconChannelAmazon, key: 'channel.amazon' },
  { id: 'flipkart', icon: IconChannelFlipkart, key: 'channel.flipkart' },
  { id: 'meesho', icon: IconChannelMeesho, key: 'channel.meesho' },
  /*
   * GeM belongs here and was missing. An artisan genuinely can hold their own GeM seller
   * account — plenty do, through a cluster or an SHG — and if they already have one, its
   * fields are worth asking for.
   *
   * ONDC deliberately is NOT here, and that is not an oversight. Nobody sells on ONDC the
   * way they sell on Amazon: it is a protocol, and an artisan reaches it through a seller
   * node. We ARE that node (channels/ondc.py) — they need no registration, no DigiReady
   * and no GST, which is the single best thing this product does for them. Putting it on
   * this grid would ask "do you have an ONDC account?", to which the honest answer is
   * "nobody has one of those, and you do not need one". Same for Hamara Bazaar, which is
   * ours: asking whether they have an account with us is a question we can answer.
   */
  { id: 'gem', icon: IconChannelGeM, key: 'channel.gem' },
  // Last on purpose: the likeliest answer. A grid whose obvious cell is first gets
  // abandoned there instead of read through.
  { id: 'whatsapp', icon: IconChannelWhatsApp, key: 'channel.whatsapp' },
];

export default function OnboardChannels() {
  const nav = useNavigate();
  const { lang } = useVoice();
  const patchArtisan = useSession((s) => s.patchArtisan);

  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function save(sells_on: string[]) {
    setBusy(true);
    setFailed(null);
    try {
      await api.patch('/me', { sells_on });
      patchArtisan({ sells_on });
      nav('/home');
    } catch (e) {
      // Recoverable and worth recovering: this answer removes questions from every future
      // product, so losing it silently would quietly cost them the whole benefit. The
      // retry button re-sends exactly what they picked.
      setFailed((e as ApiError).messageKey ?? 'error.unknown');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen prompt={failed ?? 'onboard.channels'}>
      <Grid>
        {CHANNELS.map((c) => (
          <Tile
            key={c.id}
            icon={c.icon}
            label={t(lang, c.key)}
            selected={picked.includes(c.id)}
            onClick={() => toggle(c.id)}
          />
        ))}
      </Grid>

      {picked.length > 0 ? (
        <BigButton
          icon={failed ? IconRetry : IconYes}
          labelKey={failed ? 'common.retry' : 'common.next'}
          onClick={() => save(picked)}
          disabled={busy}
          tone="yes"
        />
      ) : (
        // The honest default for most artisans, and deliberately not a quiet link.
        <BigButton
          icon={failed ? IconRetry : IconYes}
          labelKey={failed ? 'common.retry' : 'onboard.channels_none'}
          onClick={() => save([])}
          disabled={busy}
          tone="no"
        />
      )}
    </Screen>
  );
}
