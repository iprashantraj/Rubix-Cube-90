import { useEffect, useLayoutEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { routes } from './routes';
import { useVoice } from './voice/useVoice';
import { useSession } from './store';
import { applyTheme, accentColour, DEFAULT_THEME } from './ui/theme';
import Splash from './ui/Splash';
import { queryClient, persister, shouldPersistQuery } from './api/queries';

const router = createBrowserRouter(routes);


/**
 * Put the chosen palette on <html> before anything reads a colour from it.
 *
 * Layout effect, not effect: a plain useEffect runs after paint, so a themed app would
 * flash one frame of the default green on every cold start. One frame is enough to see.
 */
function useTheme() {
  const theme = useSession((s) => s.theme) ?? DEFAULT_THEME;
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return theme;
}

/**
 * Hide the splash once React has actually painted.
 *
 * `launchAutoHide` is false in capacitor.config.json on purpose — auto-hide fires on a
 * timer, so on a slow phone the splash disappears before the first screen is drawn and
 * the artisan gets a flash of white. Hiding it from here means the splash covers exactly
 * the real startup and not a millisecond more.
 *
 * The corollary is that forgetting this call leaves the app stuck on the splash forever,
 * with JavaScript running perfectly well behind it.
 */
function useHideSplash() {
  useEffect(() => {
    SplashScreen.hide().catch(() => {});
  }, []);
}

/**
 * We are online-first (docs/decisions.md), which makes losing the network a real event
 * rather than something the app quietly absorbs. So it is spoken, once, on the way down —
 * never a silent spinner the artisan stares at wondering whether the phone is broken.
 */
function useNetworkVoice() {
  const { say } = useVoice();
  useEffect(() => {
    let online = true;
    const handle = Network.addListener('networkStatusChange', ({ connected }) => {
      if (online && !connected) say('net.offline');
      online = connected;
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, [say]);
}

/**
 * The Android back gesture.
 *
 * With no listener registered, Capacitor's default closes the app on back — from any
 * screen, at any point in the flow. An artisan four screens into onboarding who swipes back
 * (the gesture every other app on their phone uses) lost all of it and started again.
 *
 * So: go back in history while there is history, and exit only from the tab roots and
 * /lang, which are the screens where "back" genuinely means "leave". `canGoBack` comes from
 * the native side and reflects the WebView's own history, so it stays correct across the
 * redirects the route Guard performs.
 */
const EXIT_ROUTES = ['/camera', '/products', '/orders', '/earnings', '/lang'];

function useHardwareBack() {
  useEffect(() => {
    const handle = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && !EXIT_ROUTES.includes(window.location.pathname)) {
        window.history.back();
      } else {
        CapacitorApp.exitApp();
      }
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);
}

/**
 * Tint the system status bar to match the app.
 *
 * Android draws the clock, battery and signal in white. Over our light-grey page that was
 * white-on-#f1f4f2 — technically rendered, practically invisible, and the artisan lost the
 * one part of the screen that is not ours: the time and their signal.
 *
 * `Style.Dark` means "dark background, so draw light content" — it is naming the background,
 * not the icons, which is the wrong way round from how it reads. Light icons on the accent
 * green is what we want.
 *
 * Wrapped in catch: on the web there is no status bar and every call rejects. A screen must
 * never fail to render because it could not paint a strip it does not have.
 *
 * The colour is READ from the stylesheet rather than written here. It used to be a literal
 * '#1f6f43', which was correct exactly as long as there was one palette — the moment the
 * app can be recoloured, a second copy of the accent means a purple header with a green
 * strip above it and a visible seam across the top of every screen. `theme` is a dependency
 * so this re-runs on every change, and it runs AFTER useTheme's layout effect because hooks
 * fire in call order.
 */
function useStatusBar(theme: string) {
  useEffect(() => {
    const accent = accentColour();
    StatusBar.setBackgroundColor({ color: accent }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    // The browser equivalent, for the PWA/dev-server case where there is no native bar.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
  }, [theme]);
}

export default function App() {
  const theme = useTheme();
  useHideSplash();
  useStatusBar(theme);
  useNetworkVoice();
  useHardwareBack();

  /*
   * The splash is React's, not the platform's, so it can be themed and animated. The native
   * one underneath is a single still frame that exists only to cover the WebView boot — see
   * ui/Splash.jsx. `done` flips when the animation has run its course; the router is mounted
   * the whole time behind it, so nothing is waiting on the artisan watching this.
   */
  const [splashDone, setSplashDone] = useState(false);

  return (
    /*
     * `dehydrateOptions` is the privacy boundary, not a tuning knob.
     *
     * It decides what reaches localStorage, and `shouldPersistQuery` refuses the paths
     * that must never be written down — the token exchange, an in-flight upload, and the
     * two job polls whose stored answer would be "still running" forever. Without this
     * predicate the persister writes every successful query it sees.
     */
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' && shouldPersistQuery(q.queryKey),
        },
      }}
    >
      <RouterProvider router={router} />
      {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
    </PersistQueryClientProvider>
  );
}
