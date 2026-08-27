import {useState} from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useApiQuery } from '../api/useApi.ts';
import { useVoice } from '../voice/useVoice.js';
import { t } from '../i18n/index.js';
import { Screen, BigButton, Card, Chip, StatusDot } from '../ui/kit.jsx';
import { IconPublish, IconPhoto } from '../ui/icons.jsx';
import { TIER } from './Channels.jsx';

/**
 * /products/:id — one product. Spec §5 row 17.
 *
 * Two things the artisan comes here for, and nothing else:
 *   1. "is this actually selling anywhere?"  -> the per-channel list
 *   2. "send it again"                        -> one button
 *
 * Everything else a detail screen usually grows (edit fields, delete, share, analytics)
 * is a text-first interaction and would have to be typed. It belongs in the voice create
 * flow, which already exists, or nowhere.
 *
 * 🔎 Two honest gaps in today's API, both deliberate rather than forgotten:
 *
 *   - There is no `GET /products/{id}`. The list endpoint returns everything this screen
 *     shows, so we filter client-side rather than asking for an endpoint that would
 *     duplicate it. If the detail view ever needs more than the list carries, that is the
 *     moment to add the route — not before.
 *   - There is no `GET /products/{id}/listings` either. The server writes a Listing row
 *     per channel on every publish, but does not yet read them back out. So until the
 *     artisan presses "send again", the per-channel column shows what each TIER can
 *     promise, not what actually happened. That distinction is stated in the UI rather
 *     than smoothed over: showing a confident green tick we have not verified is exactly
 *     the kind of lie that ends with an artisan waiting on an order that never existed.
 */
export default function ProductDetail() {
  const { id } = useParams();
  const { lang, say } = useVoice();

  // Both are the same cache entries the /products tab and /channels screen fill, so
  // tapping a product from the list it was just rendered in costs no request at all.
  const { data: list, isPending: pendingP, error: errP } = useApiQuery('/products');
  const { data: channels, isPending: pendingC, error: errC } = useApiQuery('/channels');
  const product = list ? (list.find((p) => p.id === id) ?? false) : null;
  const isPending = pendingP || pendingC;
  const [results, setResults] = useState(null); // channel id -> publish result, after a tap
  const [busy, setBusy] = useState(false);
  const [mutError, setError] = useState(null);
  const queryErr = errP ?? errC;
  const errKey = mutError ?? (queryErr ? (queryErr.messageKey ?? 'error.unknown') : null);

  // Both lists are the same cache entries the /products tab and /channels screen fill, so
  // tapping a product from the list it was just rendered in costs no request at all. The
  // product is found by filtering the cached list, so `onUpdate` has to re-filter too.

  /*
   * Re-publish fires the same set /publish fires: every tier A channel plus every already
   * connected tier B one. Tier C and D are not in the tap — a GeM .xlsx the artisan has
   * not uploaded yet is not something re-pressing a button can fix.
   */
  const oneTap = channels?.filter((c) => c.tier === 'A' || c.connected) ?? [];

  async function republish() {
    setBusy(true);
    setError(null);
    try {
      // The response already carries the finished results — /publish awaits the fan-out.
      // Read the count off `job`, never off state: `results` in this closure is still the
      // previous render's value and would report the wrong number out loud.
      const job = await api.post('/publish', { product_id: id, channels: oneTap.map((c) => c.id) });
      setResults(job.results);
      const live = Object.values(job.results).filter((r) => r.status === 'live').length;
      say('publish.done', { count: live });
    } catch (e) {
      const key = e.messageKey ?? 'error.unknown';
      setError(key);
      say(key); // errors are spoken; an English sentence on screen is not a message here
    } finally {
      setBusy(false);
    }
  }

  const prompt = errKey ?? (isPending
    ? 'common.loading'
    : product === false
      ? 'product.not_found'
      : 'product.title');

  return (
    <Screen prompt={prompt} promptVars={{ title: product?.title ?? '' }}>
            {errKey && <p className="warn">{t(lang, errKey)}</p>}

      {product && (
        <>
          <Card>
            {product.image ? (
              // The photo is the identity of the product for a user who cannot read the
              // title, so it gets the space a heading would normally take.
              <img
                src={product.image}
                alt=""
                style={{ width: '100%', borderRadius: 14, display: 'block' }}
              />
            ) : (
              <IconPhoto size={48} aria-hidden />
            )}
            <p style={{ marginBottom: 0 }}>
              {product.title ?? t(lang, 'products.untitled')}
              {product.price != null && ` · ${t(lang, 'money.rupees', { amount: product.price })}`}
            </p>
          </Card>

          {/*
            The colour lock (spec §5.6). Every adapter refuses an unconfirmed product in
            preflight, so re-publishing here would fail on every channel at once. Saying
            why up front is the difference between a broken button and an instruction.
          */}
          {!product.colour_confirmed && <p className="warn">{t(lang, 'colour.confirm')}</p>}

          <Card>
            {channels?.map((c) => {
              const r = results?.[c.id];
              return (
                <div key={c.id} className="chan" style={{ cursor: 'default' }}>
                  <StatusDot status={r ? statusDot(r.status) : TIER[c.tier].tone} />
                  <span className="chan__name">
                    {c.name}
                    <br />
                    {/* Tier is repeated on every surface that names a channel, on purpose. */}
                    <Chip tone={TIER[c.tier].tone}>{t(lang, TIER[c.tier].labelKey)}</Chip>
                  </span>
                  <span className="chan__state">
                    {r ? t(lang, r.message_key ?? `publish.result_${r.status}`) : t(lang, 'product.tier_can')}
                  </span>
                </div>
              );
            })}
          </Card>

          <BigButton
            icon={IconPublish}
            labelKey="product.republish"
            onClick={republish}
            disabled={busy || !product.colour_confirmed || oneTap.length === 0}
          />
        </>
      )}
    </Screen>
  );
}

/** PublishResult.status -> the kit's five status shapes. */
function statusDot(status) {
  if (status === 'live') return 'done';
  if (status === 'file_ready') return 'ready';
  if (status === 'failed') return 'error';
  return 'pending';
}
