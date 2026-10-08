import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any static host and inside a Capacitor shell.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
