import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'favicon.png', 'favicon.svg'],
      manifest: {
        name: 'MicroPilot',
        short_name: 'MicroPilot',
        description: 'On-device AI notification analyzer and edge intelligence assistant',
        theme_color: '#0b0916',
        background_color: '#0b0916',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'logo.png',
            sizes: '273x273',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ],
        share_target: {
          action: '/',
          method: 'GET',
          params: {
            title: 'share_title',
            text: 'share_text',
            url: 'share_url'
          }
        }
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.includes('huggingface.co') ||
              url.hostname.includes('hf.co') ||
              url.hostname.includes('cdn.jsdelivr.net'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'model-and-wasm-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          transformers: ['@huggingface/transformers']
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers']
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
