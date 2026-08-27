import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // `@/` for src, matching tsconfig paths and what shadcn's generator writes.
    // Both have to agree or an added component imports a path Vite cannot resolve.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: { outDir: 'dist' },
  server: {
    // host:true so a real phone on the LAN can load the dev server. The camera gate
    // cannot be tested in a desktop browser — plain-surface framing and accelerometer
    // tilt only mean anything on a device.
    host: true,
    proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } },
    // api/client imports ai/thresholds.json at build time, so the camera gate has a
    // floor to work from when the API is unreachable — see the comment there for why it
    // reads the real file instead of a copy. The dev server refuses to serve anything
    // above the project root without this; a production rollup build has no such limit.
    fs: { allow: ['..'] },
  },
});
