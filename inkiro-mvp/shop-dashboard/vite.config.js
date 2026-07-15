/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react    from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: true,
    // Keep tests out of the Vite build
    include: ['src/**/__tests__/**/*.test.{js,jsx}'],
  },
});
