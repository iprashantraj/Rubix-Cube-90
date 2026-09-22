import { getQueue, rupees } from '@/lib/admin';

/** /admin/queue — every product on its way to a channel, and what is holding it.
 *
 *  The one job this screen has is "why is that stuck", so the reason is on the row rather
 *  than behind a click. Four of the refusal reasons here are ones the system is *supposed*
 *  to produce — a price under the cost floor, an unconfirmed colour — and they are not
 *  errors to clear, they are the product working. */
export default async function Page() {
  const queue = await getQueue();
  const blocked = queue.filter((q) => q.blocked_on);
  const live = queue.filter((q) => q.status === 'live').length;
  const ready = queue.filter((q) => q.status === 'file_ready').length;

  return (
    <>
      <div className="head">
        <span className="eyebrow">Listing queue · {queue.length} products</span>
        <div>
          <h1>Listing queue</h1>
          <p>
            {live} live · {ready} workbook ready for upload · {blocked.length} blocked.
            A blocked row is not always a fault — the floor guard and the colour lock are
            both doing their job below.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="ph">
          <h2>Blocked</h2>
          <span className="eyebrow">Needs a decision</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Artisan</th><th>Channel</th><th>Status</th>
              <th className="num-c">Price / floor</th><th>Colour</th><th className="num-c">Updated</th>
            </tr>
          </thead>
          <tbody>
            {blocked.map((q) => (
              <tr key={q.id}>
                <td>
                  <b>{q.title ?? <i>untitled draft</i>}</b>
                  <span className="why">{q.blocked_on}</span>
                </td>
                <td>{q.artisan}<span className="sub2">{q.craft}</span></td>
                <td><span className="pill">{q.channel}</span></td>
                <td><span className={`pill ${q.status}`}>{q.status.replace('_', ' ')}</span></td>
                <td className="num-c mono">
                  {q.price === null ? '—' : rupees(q.price)}
                  <span className="sub2">floor {q.floor_price === null ? '—' : rupees(q.floor_price)}</span>
                </td>
                <td>
                  {q.colour_confirmed
                    ? <span className="pill ok">confirmed</span>
                    : <span className="pill no">unconfirmed</span>}
                </td>
                <td className="num-c mono">{q.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="ph">
          <h2>Moving</h2>
          <span className="eyebrow">Live, or waiting on a channel</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Artisan</th><th>Channel</th><th>Status</th>
              <th className="num-c">Price</th><th className="num-c">Margin over floor</th><th className="num-c">Updated</th>
            </tr>
          </thead>
          <tbody>
            {queue.filter((q) => !q.blocked_on).map((q) => {
              const margin = q.price !== null && q.floor_price
                ? Math.round(((q.price - q.floor_price) / q.floor_price) * 100)
                : null;
              return (
                <tr key={q.id}>
                  <td><b>{q.title}</b></td>
                  <td>{q.artisan}<span className="sub2">{q.craft}</span></td>
                  <td><span className="pill">{q.channel}</span></td>
                  <td><span className={`pill ${q.status}`}>{q.status.replace('_', ' ')}</span></td>
                  <td className="num-c mono">{q.price === null ? '—' : rupees(q.price)}</td>
                  <td className="num-c mono up">{margin === null ? '—' : `+${margin}%`}</td>
                  <td className="num-c mono">{q.updated}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="note">
        <b>Nothing publishes without a confirmed colour.</b> White balance moves colour, and
        only the person holding the object can say whether it is still true. A maroon saree
        that ships as orange comes back as a return and takes the artisan&apos;s rating with it —
        so the lock is in <b>preflight()</b>, which every channel adapter inherits and none
        can skip.
      </p>
    </>
  );
}
