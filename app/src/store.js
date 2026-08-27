import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
export const useSession = create(
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
      signOut: () => set({ token: null, artisan: null }),
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
export const useDraft = create((set) => ({
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
