import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession, tokenValid } from './store';
import { BottomNav } from './ui/kit';

import Home from './screens/Home';
import LangPick from './screens/LangPick';
import Consent from './screens/Consent';
import Auth from './screens/Auth';
import OnboardName from './screens/OnboardName';
import OnboardCraft from './screens/OnboardCraft';
import OnboardPlace from './screens/OnboardPlace';
import OnboardReady from './screens/OnboardReady';
import Camera from './screens/Camera';
import CaptureReview from './screens/CaptureReview';
import CatalogPrefill from './screens/CatalogPrefill';
import CatalogVoice from './screens/CatalogVoice';
import CatalogReview from './screens/CatalogReview';
import Price from './screens/Price';
import Publish from './screens/Publish';
import Products from './screens/Products';
import ProductDetail from './screens/ProductDetail';
import Channels from './screens/Channels';
import ChannelSetup from './screens/ChannelSetup';
import GstWizard from './screens/GstWizard';
import Orders from './screens/Orders';
import OrderDetail from './screens/OrderDetail';
import Earnings from './screens/Earnings';
import Help from './screens/Help';
import Settings from './screens/Settings';

/** Tabs are hidden during the create flow — mid-capture is no time to offer an exit. */
const TAB_ROUTES = ['/home', '/camera', '/products', '/orders', '/earnings'];

export function Chrome({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const show = TAB_ROUTES.includes(pathname);
  return (
    <div className="app">
      <div className="app__body">{children}</div>
      {show && <BottomNav active={pathname} />}
    </div>
  );
}

/**
 * Gate. Onboarding is strictly ordered because each step feeds the next: language decides
 * what the consent notice is spoken in, and consent must precede the phone number.
 */
function Guard({ children }: { children: ReactNode }) {
  const { lang, token, consent } = useSession();
  const { pathname } = useLocation();

  /*
   * An EXPIRED token is not a session, and this is the place that decides that.
   *
   * `tokenValid` has existed in store.js since the beginning, with a comment explaining
   * exactly why it matters — and nothing called it. The gate below tested `!token`, so a
   * long-dead token still let the artisan all the way in, and the first thing to actually
   * notice was whichever request happened to 401 first. store.js says the point is WHERE
   * they find out: a token that quietly dies mid-catalogue lands the failure on /publish,
   * after they have photographed and described a product. This runs on every navigation,
   * which makes the answer "at the next screen boundary" instead.
   *
   * Signing out rather than only redirecting, and in an effect rather than during render:
   * signOut() now also drops the response cache, and the previous artisan's catalogue must
   * not still be sitting in localStorage when the next person signs in on this phone.
   */
  const valid = tokenValid(token);
  useEffect(() => {
    if (token && !valid) useSession.getState().signOut();
  }, [token, valid]);

  if (!lang && pathname !== '/lang') return <Navigate to="/lang" replace />;
  if (lang && !consent && pathname !== '/consent') return <Navigate to="/consent" replace />;
  if (consent && !valid && pathname !== '/auth') return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

const guarded = (el: ReactNode) => (
  <Guard>
    <Chrome>{el}</Chrome>
  </Guard>
);

/**
 * All 25 route entries. Screen-by-screen rationale lives in
 * docs/Application-Architecture.md §5 — keep the two in step.
 */
export const routes = [
  { path: '/', element: <Navigate to="/home" replace /> },

  // Onboarding — 7 screens, then straight into the camera. No product tour: nobody who
  // cannot read wants one, and the first product matters more than any explanation.
  { path: '/lang', element: <LangPick /> },
  { path: '/consent', element: <Consent /> },
  { path: '/auth', element: <Auth /> },
  { path: '/onboard/name', element: guarded(<OnboardName />) },
  { path: '/onboard/craft', element: guarded(<OnboardCraft />) },
  { path: '/onboard/place', element: guarded(<OnboardPlace />) },
  { path: '/onboard/ready', element: guarded(<OnboardReady />) },

  { path: '/home', element: guarded(<Home />) },

  // Create — the core loop.
  { path: '/camera', element: guarded(<Camera />) },
  { path: '/capture/review', element: guarded(<CaptureReview />) },
  { path: '/catalog/prefill', element: guarded(<CatalogPrefill />) },
  { path: '/catalog/voice', element: guarded(<CatalogVoice />) },
  { path: '/catalog/review', element: guarded(<CatalogReview />) },
  { path: '/price', element: guarded(<Price />) },
  { path: '/publish', element: guarded(<Publish />) },

  // Catalog.
  { path: '/products', element: guarded(<Products />) },
  { path: '/products/:id', element: guarded(<ProductDetail />) },

  // Channels and account help.
  { path: '/channels', element: guarded(<Channels />) },
  { path: '/channels/:id/setup', element: guarded(<ChannelSetup />) },
  { path: '/wizard/gst', element: guarded(<GstWizard />) },

  // Orders.
  { path: '/orders', element: guarded(<Orders />) },
  { path: '/orders/:id', element: guarded(<OrderDetail />) },

  // Money and support.
  { path: '/earnings', element: guarded(<Earnings />) },
  { path: '/help', element: guarded(<Help />) },
  { path: '/settings', element: guarded(<Settings />) },

  { path: '*', element: <Navigate to="/home" replace /> },
];
