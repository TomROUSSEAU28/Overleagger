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
    // Two pages: the homepage (plain HTML, readable by search engines) and the app.
    rollupOptions: {
      input: { home: page('./index.html'), app: page('./app/index.html') },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
