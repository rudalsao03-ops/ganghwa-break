import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로 base: 앱인토스(.ait) 번들과 GitHub Pages(/ganghwa-break/) 양쪽에서 동작해요.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 4096,
    sourcemap: false,
  },
});
