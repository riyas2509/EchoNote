import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    server: {
      port: 5173,              // ✅ standard Vite port
      host: '0.0.0.0',
      strictPort: true,        // ✅ prevents fallback issues
      hmr: false               // 🔥 disables WebSocket (fixes your error)
    },

    plugins: [react()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});