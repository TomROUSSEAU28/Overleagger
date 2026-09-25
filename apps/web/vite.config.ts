import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// `base: './'` keeps the build relocatable (e.g. GitHub Pages under /<repo>/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2500,
    // The homepage, the privacy policy, the legal notice, the manual and the changelog (plain HTML, readable by search engines), and the app.
    rollupOptions: {
      input: {
        home: page('./index.html'),
        app: page('./app/index.html'),
        privacy: page('./privacy/index.html'),
        legal: page('./legal/index.html'),
        manual: page('./manual/index.html'),
        changelog: page('./changelog/index.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
