import { defineConfig } from 'vite';
import { qrcode } from 'vite-plugin-qrcode';

export default defineConfig({
  base: './', // a production build works from any subpath
  plugins: [qrcode()],
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 1200 },
});
