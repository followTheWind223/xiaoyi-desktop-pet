import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    vue(),
    ...(command === 'serve' ? [{
      name: 'desktop-pet-development-csp',
      transformIndexHtml(html: string) {
        return html.replace(
          "connect-src 'none'",
          "connect-src 'self' ws://127.0.0.1:1420 ws://localhost:1420",
        );
      },
    }] : []),
  ],
  build: {
    rollupOptions: {
      input: {
        console: resolve(__dirname, 'index.html'),
        pet: resolve(__dirname, 'pet.html'),
        bubble: resolve(__dirname, 'bubble.html'),
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
}));
