import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const frontendRoot = path.resolve(__dirname, '../frontend');

export default defineConfig({
  plugins: [react()],
  publicDir: path.join(frontendRoot, 'public'),
  resolve: {
    alias: { '@copec-frontend': frontendRoot },
  },
  server: {
    port: 5174,
    fs: { allow: [frontendRoot, __dirname] },
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});