import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In this repo, the Express backend often runs on 3001 in dev (3000 is frequently occupied by Docker).
// You can override with VITE_API_TARGET=http://localhost:3000 if needed.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

export default defineConfig({
  // Avoid writing Vite cache under node_modules/.vite (can be blocked by security tools)
  cacheDir: '.vite',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      },
      '/logo.png': {
        target: apiTarget,
        changeOrigin: true
      },
      '/favicon.png': {
        target: apiTarget,
        changeOrigin: true
      },
      '/favicon.ico': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  }
});
