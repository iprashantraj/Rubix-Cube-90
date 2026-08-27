/**
 * The voice module's public surface. Spec §6.7: every screen speaks, every error speaks,
 * every confirmation speaks. Text is the fallback, never the default.
 *
 * All of the work lives in engine.js — three tiers (server Bhashini, native Capacitor
 * TTS, Web Speech), an audio unlock, and a generation counter so a prompt from the screen
 * you just left cannot talk over the one you are on. This file stays a re-export so the
 * dozens of `from '../voice/speak.js'` imports across the screens keep working.
 */
export {
  speak,
  shutUp,
  prefetch,
  unlockAudio,
  isUnlocked,
  onUnlock,
} from './engine.js';
