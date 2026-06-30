// Polyfill crypto.randomUUID for non-secure contexts (HTTP on mobile)
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
  crypto.randomUUID = function () {
    return ('10000000-1000-4000-8000-100000000000').replace(/[018]/g, (c) => {
      const n = parseInt(c)
      return (n ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))).toString(16)
    }) as `${string}-${string}-${string}-${string}-${string}`
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
