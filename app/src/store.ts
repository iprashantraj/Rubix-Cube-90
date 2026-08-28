import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { clearSession } from './api/queries';
import type { Lang } from './i18n/index';

/**
 * Session + draft state.
 *
 * Persisted deliberately narrowly: language, auth token, and the artisan's own profile.
 * That is a resume-where-you-left-off convenience, NOT an offline store — we are
 * online-first (see docs/decisions.md). Products and orders are never cached here; they
 * are fetched. A local copy of the catalog is the first step towards a sync engine we
 * decided not to build.
 *
 * 🔒 readiness is booleans only. has_pan is true or false. The number itself never enters
 * this app, this store, or our database. What we don't store cannot leak (spec §14.1).
 */
/**
 * When does this token stop working?
 *
 * A JWT payload is base64url JSON — no library, no verification. We are not checking the
 * signature and must not pretend to: the server does that, and `exp` here is only used to
 * decide whether to bother asking. Anything unreadable returns 0, which reads as "expired"
 * and costs one clean sign-in rather than a mysterious 401 three screens later.
 *
 * The point is WHERE the artisan finds out. A 720h token quietly dying mid-catalogue means
 * the failure lands on /publish, after they photographed and described a product — the one
 * moment in the app where being thrown out costs real work.
 */
export type Artisan = {
  display_name?: string | null;
  craft?: string | null;
  pincode?: string | null;
  /**
   * Channel ids the artisan told us they already sell on, from /onboard/channels.
   *
   * Typed rather than left to the index signature below because it is read on the hot path
   * in CatalogVoice to decide which questions to ask, and `unknown` there means every
   * caller casts — which is how a `string` ends up being spread into a channel list and
   * producing one question per character.
   */
  sells_on?: string[];
  [k: string]: unknown;
};

export type Consent = { at: string; lang: Lang; notice_version: string } | null;

type SessionState = {
  lang: Lang | null;
  token: string | null;
  artisan: Artisan | null;
  consent: Consent;
  theme: string | null;
  setLang: (lang: Lang | null) => void;
  setTheme: (theme: string | null) => void;
  setConsent: (consent: Consent) => void;
  signIn: (token: string, artisan: Artisan | null) => void;
  signOut: () => void;
  patchArtisan: (patch: Partial<Artisan>) => void;
};

export function tokenExpiry(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(payload)).exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

export function tokenValid(token: string | null, now: number = Date.now()): boolean {
  // A minute of headroom: a token that expires while the request is in flight is expired.
  return !!token && tokenExpiry(token) - 60_000 > now;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      lang: null,
      token: null,
      artisan: null,
      consent: null, // { at, lang, notice_version } — the DPDP artifact
      // Which palette in ui/theme.js. Persisted alongside the language because it is the
      // same kind of setting: a preference about how the app presents itself, chosen once,
      // and jarring to lose. Null means "never chosen" and resolves to the default.
      theme: null,
      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setConsent: (consent) => set({ consent }),
      signIn: (token, artisan) => set({ token, artisan }),
      /*
       * 🔒 Dropping the token is not enough — the cached responses have to go with it.
       *
       * Signing out used to leave the previous artisan's catalogue, orders and profile
       * sitting in localStorage under `kaarigar.cache.*`, where the next person to sign in
       * on that phone would be served them from the first frame of /home. These phones get
       * handed around a family. Only the 401 path in client.js was clearing the cache, so
       * the deliberate sign-out — the one case where someone is explicitly saying "I am
       * done with this device" — was the one that did not.
       *
       * It lives here rather than at the Settings call site so no future caller of
       * signOut() has to remember, which is exactly how it went missing the first time.
       *
       * ⚠️ TWO things hold the last artisan's data, and missing either one silently
       * reopens the exact hole this comment was written about:
       *   kaarigar.query   what TanStack Query's persister wrote — survives a RESTART
       *   the QueryClient  the in-memory copy — survives a SIGN-OUT, which is worse: sign
       *                    out and straight back in as somebody else without restarting,
       *                    and /home renders the previous person's catalogue on its first
       *                    frame.
       * clearSession() in api/queries does both, which is why it is one call and not two.
       */
      signOut: () => {
        clearSession();
        set({ token: null, artisan: null });
      },
      patchArtisan: (patch) =>
        set((s) => ({ artisan: { ...s.artisan, ...patch } })),
    }),
    {
      name: 'kaarigar.session',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * The in-flight product. Lives from /camera through /publish and is cleared on success.
 * Not persisted: if the app dies mid-flow, re-shooting is a 30-second path and is far
 * safer than resurrecting a half-built listing whose photo no longer exists on the server.
 */
type Draft = {
  photoBlob: Blob | null;
  photoUrl: string | null;
  enhanceJobId: string | null;
  images: { url: string }[] | null;
  colourConfirmed: boolean;
  prefill: Record<string, unknown> | null;
  answers: Record<string, string>;
  listing: Record<string, unknown> | null;
  pricing: Record<string, unknown> | null;
  mode: 'standing' | 'flat';
  setPhoto: (blob: Blob | null, url: string | null) => void;
  setMode: (mode: 'standing' | 'flat') => void;
  setEnhance: (id: string | null) => void;
  setImages: (images: { url: string }[] | null) => void;
  confirmColour: () => void;
  setPrefill: (p: Record<string, unknown> | null) => void;
  answer: (key: string, value: string) => void;
  setListing: (l: Record<string, unknown> | null) => void;
  setPricing: (p: Record<string, unknown> | null) => void;
  reset: () => void;
};

export const useDraft = create<Draft>((set) => ({
  photoBlob: null,
  photoUrl: null,
  enhanceJobId: null,
  images: null,
  colourConfirmed: false,
  prefill: null,
  answers: {},
  listing: null, // { title, desc_en, desc_hi, category, material, ... }
  pricing: null,
  mode: 'standing', // 'flat' for dhurries and paintings — drives the tilt target

  setPhoto: (photoBlob, photoUrl) => set({ photoBlob, photoUrl }),
  setMode: (mode) => set({ mode }),
  setEnhance: (enhanceJobId) => set({ enhanceJobId }),
  setImages: (images) => set({ images }),
  confirmColour: () => set({ colourConfirmed: true }),
  setPrefill: (prefill) => set({ prefill }),
  answer: (key, value) => set((s) => ({ answers: { ...s.answers, [key]: value } })),
  setListing: (listing) => set({ listing }),
  setPricing: (pricing) => set({ pricing }),
  reset: () =>
    set({
      photoBlob: null,
      photoUrl: null,
      enhanceJobId: null,
      images: null,
      colourConfirmed: false,
      prefill: null,
      answers: {},
      listing: null,
      pricing: null,
      mode: 'standing',
    }),
}));
