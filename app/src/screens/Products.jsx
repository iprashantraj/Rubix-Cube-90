import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, Spinner } from '../ui/kit.jsx';
import { IconCreate, IconPhoto, IconForward } from '../ui/icons.jsx';

/**
 * /products — the artisan's own catalog. Spec §5 row 16.
 *
 * The catalog is OURS (spec §2 rule 1): a product lives here whether or not it has ever
 * reached a marketplace, and editing it once regenerates every channel export. So this
 * screen is not "a view of Amazon" — it is the source of truth, and it has to be legible
 * to someone who cannot read the title we wrote for them.
 *
 * Which means the photo is the identifier, not the title. A weaver recognises their own
 * saree instantly and would need help with "Handwoven Sambalpuri Cotton Saree — Ikat".
 * The thumbnail is therefore large and first; text is the caption, never the handle.
 *
 * The status chip answers exactly one question — "why is this not selling yet?" — because
 * that is the only reason to open this screen when nothing is wrong. GET /products gives
 * us `colour_confirmed` and `price`, which happen to be the two things that actually block
 * a publish (the colour lock lives in every adapter's preflight), so the chip is derived
 * rather than invented. Per-channel truth needs a listing row and lives one tap deeper, in
 * /products/:id.
 *
 * Tappables: the rows (one repeating affordance) + one primary action. Design law §3 rule
 * 1 counts kinds of action, not list length — a list of six products is one decision.
 */

/** Why this product is not selling yet, or that it is ready to. Never more than one. */
function statusOf(p) {
  // Ordered by what blocks a publish first. One problem at a time (design law rule 4) —
  // telling someone their price is unset while the colour lock is also open just buries
  // the one they have to fix first.
  if (!p.colour_confirmed) return { tone: 'error', key: 'colour.confirm' };
  if (p.price == null) return { tone: 'pending', key: 'products.no_price' };
  return { tone: 'ready', key: 'products.sellable' };
}

export default function Products() {
  const nav = useNavigate();
  const { lang } = useVoice();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/products').then(setItems, (e) => setError(e.messageKey ?? 'error.unknown'));
  }, []);

  /*
   * The spoken prompt IS the state machine. A brand-new artisan opens this screen to
   * nothing, and silence on an empty screen reads as a broken app — worse, it reads as
   * "the photo I just took was lost". Every branch below says something out loud, and
   * because `prompt` is a key the heading and the audio can never disagree.
   */
  const prompt = error ?? (items == null
    ? 'common.loading'
    : items.length === 0
      ? 'products.empty'
      : 'products.title');

  return (
    <Screen prompt={prompt} promptVars={{ count: items?.length ?? 0 }} hero>
      {items == null && !error && <Spinner label={t(lang, 'common.loading')} />}

      {error && <p className="warn">{t(lang, error)}</p>}

      {items?.length === 0 && (
        // Not a dead end. An empty catalog is the most common first view in the whole app
        // and it should point straight back at the camera, which is the only thing that
        // fixes it.
        <Card>
          <p>{t(lang, 'products.empty_help')}</p>
        </Card>
      )}

      {items?.map((p) => {
        const st = statusOf(p);
        return (
          <button key={p.id} className="chan" onClick={() => nav(`/products/${p.id}`)}>
            {p.image ? (
              <img
                src={p.image}
                alt=""
                width={56}
                height={56}
                style={{ flex: 'none', borderRadius: 12, objectFit: 'cover' }}
              />
            ) : (
              // A product with no image yet is still a real row — hiding it would look
              // like the photo upload silently failed.
              <IconPhoto size={28} aria-hidden />
            )}
            <span className="chan__name">
              {p.title ?? t(lang, 'products.untitled')}
              <br />
              <Chip tone={st.tone}>{t(lang, st.key)}</Chip>
            </span>
            <IconForward size={22} aria-hidden />
          </button>
        );
      })}

      <BigButton icon={IconCreate} labelKey="products.new" onClick={() => nav('/camera')} />
    </Screen>
  );
}
