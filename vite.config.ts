import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Update this if your GitHub repository name changes.
  base: mode === 'production' ? '/clusterpairs/' : '/',
  plugins: [react(), tailwindcss()],
}))
