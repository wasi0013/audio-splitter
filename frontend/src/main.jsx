import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Player from './player/Player'

const isPlayer = window.location.pathname.replace(/\/+$/, '').endsWith('/player')

ReactDOM.createRoot(document.getElementById('root')).render(
  isPlayer ? <Player /> : <App />
)
