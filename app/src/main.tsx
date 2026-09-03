import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { discoverApiBase } from './api/client';
import './ui/styles.css';

// Non-null: #root is in index.html and its absence is a build error, not a runtime
// state worth branching on.
const root = createRoot(document.getElementById('root')!);

/*
 * Find the API before the first screen asks for anything.
 *
 * In dev the address moves between three modes — laptop hotspot, phone hotspot, and the
 * cable via `adb reverse` — and a build-time constant cannot follow it. Probing costs one
 * request against an address that is almost always right on the first try; see the note in
 * api/client.ts.
 *
 * Deliberately NOT awaited before render. The app must start whether or not an API exists:
 * every screen already degrades to an offline path, and holding the first frame hostage to
 * a network probe would turn a working-but-serverless launch into a blank screen — for the
 * exact users whose connection is worst. The probe resolves in the background and the first
 * query picks up whatever it found.
 */
discoverApiBase().catch(() => {
  // Never fatal. `discoverApiBase` already falls back to the build-time base internally;
  // this only catches something unforeseen so it cannot take the render down with it.
});

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
