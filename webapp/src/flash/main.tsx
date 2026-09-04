import React from 'react'
import ReactDOM from 'react-dom/client'
import { applyTheme } from '../mesh/theme'
import { FlashPage } from './FlashPage'
import './flash.css'

// Same theme the analyzer is running: applyTheme() reads localStorage and
// writes --fg/--bg/--panel onto <html>, so a deck flashed from a phone in the
// amber theme sees an amber flasher. "themechange" fires when another tab
// switches it.
applyTheme()
window.addEventListener('themechange', applyTheme)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FlashPage />
  </React.StrictMode>,
)
