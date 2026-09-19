import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './mesh/TerminalApp'
import { applyTheme } from './mesh/theme'
import { preloadTDeck } from './components/tdeck-scene'

// Start the GLB + Three parse before React commits the intro, so the first
// paint can be the chassis instead of a 2D photograph.
preloadTDeck()

// Before the first render, so there is no flash of the default theme.
applyTheme()

// The mesh does not need the internet, so neither should its instrument: the
// service worker caches the app shell so lilyshark.com opens in a field with
// no signal, in airplane mode, or on the hostile network that eats
// everything but plain HTTPS. Registered only for real builds -- dev serves
// from memory and a worker would mask edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // An open tab is never told about a deploy on its own: the browser
        // only looks for a new worker on navigation. Look whenever the tab
        // comes back into view (a phone woken from the pocket, a tab
        // switched back to) and every quarter hour while it stays open.
        const check = () => {
          registration.update().catch(() => {})
        }
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) check()
        })
        window.setInterval(check, 15 * 60 * 1000)
      })
      .catch(() => {
        // A browser that refuses the worker still gets the online app.
      })

    // When a new worker takes over (it calls skipWaiting + claim), this tab
    // is still running the previous bundle. Reload once so the page matches
    // the deploy, unless the person is typing: a half-written message is
    // worth more than an early update, and the next check will catch it.
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      const active = document.activeElement
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      if (typing) return
      reloading = true
      window.location.reload()
    })
  })
}

// No providers: the terminal talks to the radio over WebSerial/BLE and to
// Shelby over plain fetch. The wallet-adapter and react-query wrappers that
// used to sit here served screens that no longer exist, and together they
// were most of the main bundle.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
