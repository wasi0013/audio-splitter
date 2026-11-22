import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'

const isPlayer = window.location.pathname.replace(/\/+$/, '').endsWith('/player')
// load only the page that is shown, so the splitter's global CSS never reaches the player
// two separate import() calls: Vite attaches CSS to each one; a single ternary got only App's CSS
const Page = isPlayer ? lazy(() => import('./player/Player')) : lazy(() => import('./App'))

ReactDOM.createRoot(document.getElementById('root')).render(
  <Suspense fallback={null}><Page /></Suspense>
)
