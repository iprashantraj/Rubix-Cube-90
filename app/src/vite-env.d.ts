/// <reference types="vite/client" />

/*
 * Side-effect CSS imports and the build-time thresholds JSON.
 *
 * Without the vite/client reference above, `import './ui/styles.css'` in main.tsx is an
 * error under TS7 — the compiler has no idea Vite will turn that into a stylesheet rather
 * than a module it should be able to resolve types for.
 */
