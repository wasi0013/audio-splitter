import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'

const isPlayer = window.location.pathname.replace(/\/+$/, '').endsWith('/player')
// load only the page that is shown, so the splitter's global CSS never reaches the player
const Page = lazy(() => (isPlayer ? import('./player/Player') : import('./App')))

ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense fallback={null}><Page /></Suspense>
)
