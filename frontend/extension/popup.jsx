import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { matchSurahs } from '../src/player/library'
import './popup.css'

const fmt = (t) => {
  if (t == null || !isFinite(t)) return '–:––'
  t = Math.max(0, Math.floor(t))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const send = (msg) => new Promise((resolve) => {
  try {
    chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r ?? null) })
  } catch { resolve(null) }
})

function Popup() {
  const [st, setSt] = useState(undefined)   // undefined = checking, null = no player tab
  const [q, setQ] = useState('')
  const input = useRef(null)

  const poll = async () => setSt(await send({ to: 'player' }))
  useEffect(() => {
    poll()
    const id = setInterval(poll, 500)
    return () => clearInterval(id)
  }, [])

  const cmd = async (c, ...args) => setSt((await send({ to: 'player', cmd: c, args })) ?? st)
  const open = () => send({ to: 'background', type: 'openPlayer' }).then(() => window.close())
  const suggestions = q.trim() && !/^\d+:\d+$/.test(q.trim()) ? matchSurahs(q).slice(0, 5) : []

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return
      const map = { ' ': 'toggle', ArrowDown: 'nextChunk', ArrowUp: 'prevChunk', ArrowRight: ['seekBy', 5], ArrowLeft: ['seekBy', -5], l: 'loopChunk', '[': 'prevSurah', ']': 'nextSurah' }
      const m = map[e.key]
      if (m) { e.preventDefault(); Array.isArray(m) ? cmd(...m) : cmd(m) }
      if (e.key === '/') { e.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (st === undefined) return <div className="pp"><p className="pp-muted">…</p></div>
  if (st === null) {
    return (
      <div className="pp pp-empty">
        <h1>Recitation Player</h1>
        <p className="pp-muted">The player tab isn’t open.</p>
        <button className="pp-primary" onClick={open}>Open player</button>
        <p className="pp-muted pp-small">It opens as a pinned tab so audio keeps playing while you work.</p>
      </div>
    )
  }

  const len = st.end != null ? st.end - st.start : null
  const pos = Math.max(0, st.time - st.start)
  return (
    <div className="pp">
      <div className="pp-top">
        <div>
          <div className="pp-kicker">Surah {st.surah}{st.chunks > 1 ? ` · chunk ${st.chunk + 1}/${st.chunks}` : ''}</div>
          <div className="pp-title">{st.tr}</div>
        </div>
        <div className="pp-ar" lang="ar">{st.ar}</div>
      </div>
      <div className="pp-line">
        <span className="pp-label">{st.label || (st.chunks > 1 ? `Chunk ${st.chunk + 1}` : 'Whole surah')}</span>
        <span className="pp-muted">{fmt(pos)} / {fmt(len)}</span>
      </div>
      <div className="pp-bar"><div style={{ width: len ? `${Math.min(100, (pos / len) * 100)}%` : 0 }} /></div>

      <div className="pp-controls">
        <button title="Previous surah  [" onClick={() => cmd('prevSurah')}>⏮</button>
        <button title="Previous chunk  ↑" onClick={() => cmd('prevChunk')}>⇤</button>
        <button title="Back 5 s  ←" onClick={() => cmd('seekBy', -5)}>↺5</button>
        <button className="pp-play" title="Play / pause  Space" onClick={() => cmd('toggle')}>{st.playing ? '❚❚' : '▶'}</button>
        <button title="Forward 5 s  →" onClick={() => cmd('seekBy', 5)}>5↻</button>
        <button title="Next chunk  ↓" onClick={() => cmd('nextChunk')}>⇥</button>
        <button title="Next surah  ]" onClick={() => cmd('nextSurah')}>⏭</button>
      </div>
      <div className="pp-row">
        <button className={`pp-toggle${st.loop === 'chunk' ? ' on' : ''}`} onClick={() => cmd('loopChunk')} title="Loop chunk  L">🔁 Loop chunk</button>
        <button className="pp-link" onClick={open}>Open player ↗</button>
      </div>

      <form className="pp-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { cmd('jump', q); setQ('') } }}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to: 18, kahf, 2:255   ( / )" />
      </form>
      {suggestions.length > 0 && (
        <div className="pp-sugg">
          {suggestions.map((s) => (
            <button key={s.n} onClick={() => { cmd('jump', String(s.n)); setQ('') }}>
              <span className="pp-muted">{s.n}</span> {s.tr} <span className="pp-ar-sm" lang="ar">{s.ar}</span>
            </button>
          ))}
        </div>
      )}
      <button className="pp-foot" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
        Shortcuts: ⌥⇧P play · ⌥⇧↑/↓ chunk · ⌥⇧L loop — customise, or make one Global (⌘⇧0–9) to use outside Chrome
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Popup />)
