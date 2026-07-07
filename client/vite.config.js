import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true → le serveur de dev écoute sur le réseau local (accessible
  // depuis le téléphone via l'IP du PC, ex http://192.168.1.199:5173).
  server: { host: true },
})
