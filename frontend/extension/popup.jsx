import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { matchSurahs } from '../src/player/library'
import * as I from '../src/player/icons'
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

  if (st === undefined) return <div className="pp"><div className="pp-spin" aria-label="Connecting" /></div>
  if (st === null) {
    return (
      <div className="pp pp-empty">
        <I.Logo width="40" height="40" />
        <h1>Recitation Player</h1>
        <p className="pp-muted">The player tab isn’t open.</p>
        <button className="pp-primary" onClick={open}><I.Play size={16} /> Open player</button>
        <p className="pp-muted pp-small">It opens as a pinned tab, so audio keeps playing while you work.</p>
      </div>
    )
  }

  const unit = st.unit || 'Part'
  const len = st.end != null ? st.end - st.start : null
  const pos = Math.max(0, st.time - st.start)
  const seek = (e) => {
    if (!len) return
    const r = e.currentTarget.getBoundingClientRect()
    cmd('seekTo', st.start + ((e.clientX - r.left) / r.width) * len)
  }
  return (
    <div className="pp">
      <div className="pp-top">
        <div className="pp-top-text">
          <div className="pp-kicker">Surah {st.surah}{st.chunks > 1 ? ` · ${unit} ${st.chunk + 1} of ${st.chunks}` : ''}</div>
          <div className="pp-title">{st.tr}</div>
        </div>
        <div className="pp-ar" lang="ar">{st.ar}</div>
      </div>
      <div className="pp-line">
        <span className="pp-label">{st.label || (st.chunks > 1 ? `${unit} ${st.chunk + 1}` : 'Whole surah')}</span>
        <span className="pp-muted pp-tab">{fmt(pos)} / {fmt(len)}</span>
      </div>
      <div className="pp-bar" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(len || 0)} aria-valuenow={Math.round(pos)} onClick={seek}>
        <div style={{ width: len ? `${Math.min(100, (pos / len) * 100)}%` : 0 }} />
      </div>

      <div className="pp-controls">
        <button aria-label="Previous surah" title="Previous surah  [" onClick={() => cmd('prevSurah')}><I.SkipBack size={16} /></button>
        <button aria-label={`Previous ${unit.toLowerCase()}`} title={`Previous ${unit.toLowerCase()}  ↑`} onClick={() => cmd('prevChunk')}><I.PrevUnit size={18} /></button>
        <button aria-label="Back 5 seconds" title="Back 5 s  ←" onClick={() => cmd('seekBy', -5)}><I.Back5 size={18} /></button>
        <button className="pp-play" aria-label={st.playing ? 'Pause' : 'Play'} title="Play / pause  Space" onClick={() => cmd('toggle')}>{st.playing ? <I.Pause size={20} /> : <I.Play size={20} />}</button>
        <button aria-label="Forward 5 seconds" title="Forward 5 s  →" onClick={() => cmd('seekBy', 5)}><I.Fwd5 size={18} /></button>
        <button aria-label={`Next ${unit.toLowerCase()}`} title={`Next ${unit.toLowerCase()}  ↓`} onClick={() => cmd('nextChunk')}><I.NextUnit size={18} /></button>
        <button aria-label="Next surah" title="Next surah  ]" onClick={() => cmd('nextSurah')}><I.SkipFwd size={16} /></button>
      </div>
      <div className="pp-row">
        <button className={`pp-toggle${st.loop === 'chunk' ? ' on' : ''}`} aria-pressed={st.loop === 'chunk'} onClick={() => cmd('loopChunk')} title={`Repeat this ${unit.toLowerCase()}  L`}>
          <I.Repeat1 size={16} /> Repeat {unit.toLowerCase()}
        </button>
        <button className="pp-link" onClick={open}>Open player</button>
      </div>

      <form className="pp-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { cmd('jump', q); setQ('') } }}>
        <I.Search size={15} />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Go to surah or verse" placeholder="Go to: 18, kahf, 2:255" />
        <kbd>/</kbd>
      </form>
      {suggestions.length > 0 && (
        <div className="pp-sugg">
          {suggestions.map((s) => (
            <button key={s.n} onClick={() => { cmd('jump', String(s.n)); setQ('') }}>
              <span className="pp-num">{s.n}</span> {s.tr} <span className="pp-ar-sm" lang="ar">{s.ar}</span>
            </button>
          ))}
        </div>
      )}
      <button className="pp-foot" onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
        <I.Keyboard size={14} /> ⌥⇧P play · ⌥⇧↑/↓ {unit.toLowerCase()} · ⌥⇧L repeat — customise shortcuts
      </button>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Popup />)
