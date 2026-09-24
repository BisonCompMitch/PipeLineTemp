import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/builder/export-pdf': {
        target: process.env.VITE_BISON_BUILDER_TARGET || 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/builder\/export-pdf/, '/api/builder/export-pdf')
      },
      '^/builder(?:/|$)': {
        target: process.env.VITE_LOCAL_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true
      },
      '^/projects(?:/|$)': {
        target: process.env.VITE_LOCAL_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true
      },
      '/api': {
        target: process.env.VITE_LOCAL_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
