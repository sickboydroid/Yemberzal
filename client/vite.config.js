import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In production the server serves client/dist itself, so no proxy is needed.
// The proxy below is only for `npm run dev` (hot-reload development).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
