import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: { charts: ['lightweight-charts'], react: ['react', 'react-dom'] },
      },
    },
  },
  resolve: { alias: { '@': '/apps/web/src' } },
});
