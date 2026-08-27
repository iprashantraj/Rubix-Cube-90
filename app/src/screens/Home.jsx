import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useSession } from '../store.js';
import { t } from '../i18n/index.js';
import { useVoice } from '../voice/useVoice.js';
import { Screen, BigButton, Spinner } from '../ui/kit.jsx';
import { IconCreate, IconForward, IconPhoto } from '../ui/icons.jsx';

/**
 * /home — where the app opens.
 *
 * It used to open straight into /camera, so the first thing a new artisan ever heard, before
 * touching anything, was "move into the light". Taking a photo is now something you decide
 * to do.
 *
 * This was also the one screen that composed its own chrome, which is exactly why the accent
 * header existed here and nowhere else. It is now `hero` on the shared <Screen> (kit.jsx),
 * and /products, /orders, /earnings and /settings wear the same one — so moving between tabs
 * no longer changes the shape of the app, and the white system clock stays legible on every
 * one of them instead of just this one.
 *
 * The products are shown as PICTURES, not as the numeral 4. An artisan recognises their own
 * saree instantly and cannot necessarily read the word next to it — and a screen about
 * their work should look like their work.
 */
export default function Home() {
  const nav = useNavigate();
  const { lang } = useVoice();
  const artisan = useSession((s) => s.artisan);

  const [products, setProducts] = useState(null);
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Both endpoints already exist and are already paid for by the tabs. A /home/summary
      // route would be a third thing to keep in step with them for no benefit at this size.
      const [p, o] = await Promise.all([
        api.get('/products').catch(() => []),
        api.get('/orders').catch(() => []),
      ]);
      if (!alive) return;
      setProducts(Array.isArray(p) ? p : (p?.items ?? []));
      setOrders(Array.isArray(o) ? o : (o?.items ?? []));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const named = Boolean(artisan?.display_name);
  const promptKey = named ? 'home.greeting_named' : 'home.greeting';
  const promptVars = { name: artisan?.display_name };

  const newOrders = (orders ?? []).filter((o) => o.state === 'new').length;
  const owed = (orders ?? [])
    .filter((o) => o.payment_state === 'pending')
    .reduce((sum, o) => sum + (o.amount ?? 0), 0);

  return (
    <Screen
      prompt={promptKey}
      promptVars={promptVars}
      hero
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
            <Fact n={t(lang, 'money.rupees', { amount: owed })} labelKey="home.stat_money" />
          </div>
        )
      }
      /*
        The one action, pinned to the bottom where the thumb already is. It duplicates the
        centre button in the tab bar deliberately: the tab bar is chrome an artisan has to
        learn, and on first run there is nothing else on this screen to press.
      */
      footer={<BigButton icon={IconCreate} labelKey="home.add" onClick={() => nav('/camera')} />}
    >
      {!products && <Spinner label={t(lang, 'common.loading')} />}

      {products && products.length === 0 && <p className="said">{t(lang, 'products.empty_help')}</p>}

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
                {p.image ? (
                  <img src={p.image} alt={p.title ?? ''} loading="lazy" />
                ) : (
                  <span className="shot__none">
                    <IconPhoto size={34} aria-hidden />
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

function Fact({ n, labelKey, tone }) {
  const { lang } = useVoice();
  return (
    <div className={`fact${tone ? ` fact--${tone}` : ''}`}>
      <span className="fact__n">{n}</span>
      <span className="fact__l">{t(lang, labelKey)}</span>
    </div>
  );
}
