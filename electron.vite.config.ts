import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@shared': resolve(__dirname, 'shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'electron/main.ts') } } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias: { ...alias, '@': resolve(__dirname, 'src') } },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/index.html') } } }
  }
})
