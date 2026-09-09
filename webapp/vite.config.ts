import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sharedCoverage } from './server/sharedCoverage'
import { communityDirectory } from './server/communityDirectory'
import { forwardCoverageRequest } from './server/meshmapperCoverage'
import { createHash } from 'node:crypto'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Emit a service worker whose precache list is the build's real output.
 *
 *  Written by hand rather than pulled in as a plugin dependency: the whole
 *  job is "list the files, cache the files", and a dependency that does that
 *  for us is a supply-chain risk doing forty lines of work.
 *
 *  Only the app shell is precached — index.html and the hashed bundles — so
 *  install stays fast. Everything else same-origin (docs pages, the
 *  whitepaper, map assets) is cached the first time it is seen, which means
 *  a screen you have opened once keeps working with no network at all.
 */
function offlineWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'lilyshark-offline-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const shell: string[] = ['/', '/manifest.webmanifest']
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) {
            if (relative(outDir, full) === 'assets') walk(full)
            continue
          }
          const rel = '/' + relative(outDir, full).split('\\').join('/')
          const isBundle = rel.startsWith('/assets/')
          const isRootShell =
            rel === '/index.html' || rel.endsWith('.svg') || rel === '/apple-touch-icon.png'
          if ((isBundle || (dir === outDir && isRootShell)) && rel !== '/sw.js') {
            shell.push(rel)
          }
        }
      }
      walk(outDir)
      const version = createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 16)
      const worker = `// Generated at build time; the precache list is the build itself.
const CACHE = 'lilyshark-${version}'
const SHELL = ${JSON.stringify(shell.sort(), null, 2)}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Cross-origin (tiles, brokers) and the API stay live: caching either
  // would show stale mesh state as if it were current, which is worse than
  // an honest failure.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return

  if (request.mode === 'navigate') {
    // The app is a single page: any route serves the shell, offline included.
    event.respondWith(
      fetch(request).catch(() => caches.match('/').then((hit) => hit ?? caches.match('/index.html'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
`
      writeFileSync(join(outDir, 'sw.js'), worker)
      this.info(`sw.js: ${shell.length} shell files precached (cache lilyshark-${version})`)
    },
  }
}

function coverageAPI(): Plugin {
  return {
    name: 'meshmapper-coverage-api',
    configureServer(server) {
      server.middlewares.use('/api/community-coverage', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        const result = await sharedCoverage()
        res.statusCode = result.status
        for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value)
        res.end(result.body)
      })
      server.middlewares.use('/api/mesh-directory', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
        res.setHeader('Content-Type', 'application/json')
        try { res.end(JSON.stringify(await communityDirectory())) }
        catch { res.statusCode = 502; res.end(JSON.stringify({ error: 'The node directory could not be loaded.' })) }
      })
      server.middlewares.use('/api/meshmapper-coverage', async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store')
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (body.length > 4096) { res.statusCode = 413; res.end(); return }
        }
        try {
          const result = await forwardCoverageRequest(JSON.parse(body))
          res.statusCode = result.status
          for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value)
          res.end(result.body)
        } catch { res.statusCode = 400; res.end('{}') }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), coverageAPI(), offlineWorker()],
  build: {
    rollupOptions: {
      // Multi-page: the analyzer at / and the browser flasher at /flash/.
      input: {
        main: join(__dirname, 'index.html'),
        flash: join(__dirname, 'flash', 'index.html'),
      },
    },
  },
  server: {
    port: 3002,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
