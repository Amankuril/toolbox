import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_DEV_API_TARGET || 'http://localhost:5000'
  // Same-origin in dev too, so refresh cookies behave exactly as they do behind nginx.
  const proxy = {
    '/api': { target: apiTarget, xfwd: true },
    '/uploads': { target: apiTarget },
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
    build: {
      target: 'es2022',
      sourcemap: 'hidden',
      chunkSizeWarningLimit: 700,
    },
  }
})
