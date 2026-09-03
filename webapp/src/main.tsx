import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './mesh/TerminalApp'
import { seedDemo } from './mesh/demo'
import { applyTheme } from './mesh/theme'

// Before the first render, so there is no flash of the default theme.
applyTheme()

// The mesh does not need the internet, so neither should its instrument: the
// service worker caches the app shell so lilyshark.com opens in a field with
// no signal, in airplane mode, or on the hostile network that eats
// everything but plain HTTPS. Registered only for real builds -- dev serves
// from memory and a worker would mask edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // A browser that refuses the worker still gets the online app.
    })
  })
}

// Also before the first render: seeded from an effect the app painted a row of
// empty panels first and then filled them, which reads as a loading bug. No
// radio can be attached this early, so this can never touch real data.
seedDemo()

// No providers: the terminal talks to the radio over WebSerial/BLE and to
// Shelby over plain fetch. The wallet-adapter and react-query wrappers that
// used to sit here served screens that no longer exist, and together they
// were most of the main bundle.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
