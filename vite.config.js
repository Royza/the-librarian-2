import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5273, open: false },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
  },
});
