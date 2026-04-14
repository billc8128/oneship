import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        // Plan B: electron-vite 5.x only honors main/preload/renderer keys, so the
        // agent worker entry ships as a second input under the main build. Both land
        // in dist/main/ as index.js and agent.js. utilityProcess.fork() loads the
        // agent from dist/main/agent.js (Task 10 will encode this path).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          agent: resolve(__dirname, 'src/agent/index.ts')
        },
        external: ['node-pty']
      }
    }
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        output: {
          format: 'es'
        }
      }
    },
    html: {
      cspNonce: undefined
    },
    plugins: [
      tailwindcss(),
      react(),
      {
        name: 'remove-crossorigin',
        transformIndexHtml(html) {
          return html.replace(/ crossorigin/g, '')
        }
      }
    ]
  }
})
