import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getArtisan, getArtisans, getQueue, getOrders, rupees } from '@/lib/admin';

/** /admin/artisans/[id] — one artisan, everything a coordinator can act on.
 *
 *  `generateStaticParams` is what lets this deploy to Vercel with no backend: the routes
 *  are baked at build time from the same fixtures. Once an admin API exists, delete it and
 *  the route goes dynamic — nothing else on the page changes. */
export async function generateStaticParams() {
  return (await getArtisans()).map((a) => ({ id: a.id }));
}

const FLAGS = [
  ['has_pan', 'PAN on file'],
  ['has_bank', 'Bank linked'],
  ['has_gst', 'GST registered'],
  ['has_artisan_card', 'Artisan card'],
] as const;

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getArtisan(id);
  if (!a) notFound();

  const [queue, orders] = await Promise.all([getQueue(), getOrders()]);
  const theirs = queue.filter((q) => q.artisan === a.display_name);
  const theirOrders = orders.filter((o) => o.artisan === a.display_name);

  return (
    <>
      <div className="head">
        <span className="eyebrow">
          <Link href="/admin/artisans" style={{ color: 'inherit' }}>← Artisans</Link>
        </span>
        <div>
          <h1>{a.display_name}</h1>
          <p>
            {a.craft} · {a.cluster}, {a.district}, {a.state} · joined {a.joined} ·
            speaks <b>{a.language}</b>
          </p>
        </div>
      </div>

      <div className="cols">
        <div>
          <div className="panel">
            <div className="ph">
              <h2>Listings</h2>
              <span className="eyebrow">{a.live_listings} live of {a.products}</span>
            </div>
            {theirs.length === 0 ? (
              <p className="note">Nothing in the queue right now.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Product</th><th>Channel</th><th>Status</th><th className="num-c">Price</th></tr>
                </thead>
                <tbody>
                  {theirs.map((q) => (
                    <tr key={q.id}>
                      <td>
                        {q.title ?? <i>untitled draft</i>}
                        {q.blocked_on && <span className="why">{q.blocked_on}</span>}
                      </td>
                      <td><span className="pill">{q.channel}</span></td>
                      <td><span className={`pill ${q.status}`}>{q.status.replace('_', ' ')}</span></td>
                      <td className="num-c mono">
                        {q.price === null ? '—' : rupees(q.price)}
                        <span className="sub2">floor {q.floor_price === null ? '—' : rupees(q.floor_price)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <div className="ph">
              <h2>Orders</h2>
              <span className="eyebrow">{rupees(a.gmv)} realised</span>
            </div>
            {theirOrders.length === 0 ? (
              <p className="note">No orders yet.</p>
            ) : (
              <table>
                <thead>
                  <tr><th>Order</th><th>Channel</th><th>State</th><th className="num-c">Amount</th><th>Paid?</th></tr>
                </thead>
                <tbody>
                  {theirOrders.map((o) => (
                    <tr key={o.id}>
                      <td>
                        {o.product}
                        <span className="sub2 mono">{o.external_order_id ?? o.id} · ×{o.quantity}</span>
                      </td>
                      <td><span className="pill">{o.channel}</span></td>
                      <td><span className={`pill ${o.state}`}>{o.state}</span></td>
                      <td className="num-c mono">{rupees(o.amount)}</td>
                      <td>
                        {o.artisan_confirmed_payment === true && <span className="pill ok">arrived</span>}
                        {o.artisan_confirmed_payment === false && <span className="pill no">not yet</span>}
                        {o.artisan_confirmed_payment === null && <span className="sub2">not asked</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="panel">
            <div className="ph"><h2>Readiness</h2></div>
            {FLAGS.map(([key, label]) => (
              <div key={key} className="chrow">
                <u style={{ background: a[key] ? 'var(--c-green)' : 'var(--hair-2)' }} />
                <em>{label}</em>
                <s className="mono">{a[key] ? 'yes' : 'no'}</s>
              </div>
            ))}
            <div className="chrow">
              <u style={{ background: a.name_check_passed ? 'var(--c-green)' : 'var(--c-rose)' }} />
              <em>Name consistency check</em>
              <s className="mono">
                {a.name_check_passed === null ? 'not run' : a.name_check_passed ? 'passed' : 'failed'}
              </s>
            </div>
            <p className="note" style={{ marginTop: 14 }}>
              <b>Flags only.</b> The PAN number, the account number and the GSTIN have no
              column in any table. There is nothing here to open, and nothing to leak.
            </p>
          </div>

          <div className="panel">
            <div className="ph"><h2>Channels</h2></div>
            <p className="note">
              Told us at onboarding that they already sell on:{' '}
              {a.sells_on.length === 0 ? <b>nothing — this is their first channel</b>
                : <b>{a.sells_on.join(', ')}</b>}.
            </p>
            <p className="note" style={{ marginTop: 12 }}>
              That is separate from whether we hold a token for them. Someone with an Amazon
              account they have not connected gets a Connect button; someone who has never
              heard of Amazon is not offered it at all.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
