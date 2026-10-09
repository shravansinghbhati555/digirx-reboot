/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ["digirx.coderly.in", "digirx-reboot.abhianand.in"]
  },
  // Pinned so the preview build always serves on a known origin. Without
  // strictPort, a busy 4173 silently shifts to 4174 and every API call fails
  // CORS — which surfaces as "no connection to the server" and looks like an
  // offline bug rather than a config one.
  preview: {
    port: 4173,
    strictPort: true,
  },
  test: {
    // `node` rather than jsdom: these cover the offline layer's logic —
    // replay classification, the queue state machine, leases, session
    // expiry — none of which needs a DOM. `fake-indexeddb` supplies the one
    // browser API they do use.
    environment: 'node',
    setupFiles: ['./src/offline/test-setup.ts'],
    // Only the offline layer for now. Playwright still owns end-to-end.
    include: ['src/**/*.test.ts'],
  },
});

