import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Tailwind only ever processes src/v0-dashboard/theme.css (the isolated
    // /v0-dashboard-test page's own CSS entry) — it is never imported by
    // src/index.css, so the main app's global stylesheet never gains
    // Tailwind's utility classes and vice versa.
    tailwindcss(),
    // Serve /v0-dashboard-test (no extension) as v0-dashboard-test.html in
    // dev, matching the production rewrite in netlify.toml / vercel.json.
    {
      name: 'v0-dashboard-test-route',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/v0-dashboard-test') req.url = '/v0-dashboard-test.html'
          next()
        })
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        v0DashboardTest: fileURLToPath(new URL('./v0-dashboard-test.html', import.meta.url)),
      },
    },
  },
})
