import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

// Chrome extension build: `npm run build:extension` → dist-extension/ (load unpacked in chrome://extensions)
export default defineConfig({
  root: here('./extension'),
  publicDir: here('./extension/static'),
  plugins: [react()],
  build: {
    outDir: here('./dist-extension'),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      input: { player: here('./extension/player.html'), popup: here('./extension/popup.html') },
    },
  },
})
