import { defineConfig } from 'vite';

export default defineConfig({
  // osm2streets is a wasm-bindgen package; keep it out of dependency pre-bundling so its .wasm resolves cleanly
  optimizeDeps: { exclude: ['osm2streets-js'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
