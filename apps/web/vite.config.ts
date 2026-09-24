import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `base: './'` keeps the build relocatable (e.g. GitHub Pages under /<repo>/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2500,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
