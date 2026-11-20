import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Engine } from './engine'
import { SURAHS, matchSurahs, buildChunks, canPickFolders, loadConfig, saveConfig, openLibrary, permissionState, pickFolder } from './library'
import { estimateDuration } from './mp3Index'
import './player.css'

const LS = 'recitation-player:state'
const loadState = () => { try { return JSON.parse(localStorage.getItem(LS)) || {} } catch { return {} } }
const saveState = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)) } catch { /* private mode */ } }

const fmt = (t) => {
  if (t == null || !isFinite(t)) return '–:––'
  t = Math.max(0, Math.floor(t))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
const fmtDur = (t) => {
  if (t == null || !isFinite(t)) return ''
  const r = Math.round(t), m = Math.floor(r / 60), s = r % 60
  return m ? (s ? `${m}m ${s}s` : `${m}m`) : `${s}s`
}
const chunkAt = (chunks, t) => {
  let i = 0
  while (i + 1 < chunks.length && chunks[i + 1].start <= t + 0.05) i++
  return i
}
const urlName = (u) => decodeURIComponent(u.replace(/\/+$/, '').split('/').pop() || 'markers')

const REPEATS = [0, 2, 3, 5, 7, 10]
const GAPS = [0, 1, 2, 3, 5, 10]
const SPEEDS = [0.75, 0.85, 1, 1.1, 1.25, 1.5]
const SLEEP = [15, 30, 45, 60, 90]

export default function Player({ embedded = null }) {
  const saved = useMemo(loadState, [])
  const engine = useMemo(() => new Engine(), [])
  if (import.meta.env.DEV) window.__engine = engine
  const [cfg, setCfg] = useState(null)
  const [status, setStatus] = useState('loading') // loading | setup | reconnect | ready
  const [error, setError] = useState(null)
  const [lib, setLib] = useState(null)
  const [layer, setLayer] = useState(saved.layer ?? 0)
  const [surah, setSurah] = useState(saved.surah ?? 1)
  const [time, setTime] = useState(saved.time ?? 0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [durations, setDurations] = useState({})
  const [loop, setLoop] = useState(saved.loop ?? 'off')        // off | chunk | surah | range
  const [repeat, setRepeat] = useState(saved.repeat ?? 0)      // 0 = forever, N = play N times then move on
  const [gap, setGap] = useState(saved.gap ?? 0)
  const [speed, setSpeed] = useState(saved.speed ?? 1)
  const [stopAfter, setStopAfter] = useState('never')          // never | chunk | surah
  const [sleepAt, setSleepAt] = useState(null)
  const [range, setRange] = useState(null)                     // { from, to } chunk indices of current surah
  const [query, setQuery] = useState('')
  const [urlForm, setUrlForm] = useState({ audio: '', markers: '' })
  const [now, setNow] = useState(Date.now())

  const unitRef = useRef(null)      // { kind: 'surah'|'chunk'|'range', surah, chunk }
  const playsRef = useRef(0)
  const gapTimer = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)

  const durationsRef = useRef({})
  durationsRef.current = durations
  const markersOf = useCallback((n) => lib?.layers[layer]?.markers.get(n), [lib, layer])
  const chunksOf = useCallback((n) => buildChunks(n, markersOf(n), durations[n] ?? null), [markersOf, durations])
  const chunks = useMemo(() => chunksOf(surah), [chunksOf, surah])
  // a chunk-sized unit owns the display even when playback stopped exactly on its end boundary
  const u0 = unitRef.current
  const ci = u0?.kind === 'chunk' && u0.surah === surah && u0.chunk < chunks.length ? u0.chunk : chunkAt(chunks, time)
  const chunk = chunks[ci]
  const duration = durations[surah] ?? null
  const info = SURAHS[surah - 1]

  // latest values for event handlers
  const S = useRef({})
  S.current = { surah, chunks, chunksOf, loop, repeat, gap, stopAfter, range, lib, time }

  // ---------- engine wiring ----------
  useEffect(() => {
    engine.rate = speed
  }, [engine, speed])

  const go = useCallback(async (n, { at = 0, play = true, keepPlays = false, ...over } = {}) => {
    const st = { ...S.current, ...over }
    if (!st.lib?.audio.has(n)) return
    clearTimeout(gapTimer.current)
    const ch = st.chunksOf(n)
    const i = chunkAt(ch, at)
    let kind = 'surah', start = 0, end = null
    if (st.loop === 'range' && st.range && n === S.current.surah) {
      const r = st.range
      if (i < r.from || i > r.to) setRange({ from: i, to: i })
      const from = i < r.from || i > r.to ? i : r.from, to = i < r.from || i > r.to ? i : r.to
      kind = 'range'; start = ch[from].start; end = to + 1 < ch.length ? ch[to + 1].start : null
    } else if (st.loop === 'chunk' || st.stopAfter === 'chunk') {
      kind = 'chunk'; start = ch[i].start; end = i + 1 < ch.length ? ch[i + 1].start : null
    }
    at = Math.max(at, start)
    if (!keepPlays) playsRef.current = 0
    const u = unitRef.current, eu = engine.unit
    unitRef.current = { kind, surah: n, chunk: i }
    setSurah(n)
    // same slice already loaded → just seek
    if (u && eu && u.kind === kind && eu.surah === n && Math.abs(eu.start - start) < 0.01 && (eu.end === end || (end == null && kind === 'surah')) && engine.seek(at)) {
      if (play) engine.play()
      return
    }
    setBusy(true); setError(null)
    try {
      await engine.load(n, st.lib.audio.getBlob, { start, end, at, play })
      const d = engine.duration(n)
      if (d) setDurations((x) => (x[n] === d ? x : { ...x, [n]: d }))
    } catch (e) {
      setError(`Could not play surah ${n}: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }, [engine])

  const nextAvailable = (n, dir) => {
    for (let k = n + dir; k >= 1 && k <= 114; k += dir) if (S.current.lib?.audio.has(k)) return k
    return null
  }

  const actions = {
    toggle: () => {
      if (!engine.hasUnit) return go(S.current.surah, { at: S.current.time })
      engine.playing ? engine.pause() : engine.play()
    },
    seekBy: (d) => {
      const u = engine.unit
      if (!u) return
      const t = Math.min(Math.max(engine.time + d, u.start), (u.end ?? Infinity) - 0.05)
      if (!engine.seek(t)) go(S.current.surah, { at: t, play: engine.playing })
    },
    seekTo: (t) => { if (!engine.seek(t)) go(S.current.surah, { at: t, play: engine.playing || !engine.hasUnit }) },
    chunk: (n, i) => go(n, { at: S.current.chunksOf(n)[i]?.start ?? 0 }),
    nextChunk: () => {
      const { surah: n, chunks: ch } = S.current
      const i = chunkAt(ch, engine.time)
      if (i + 1 < ch.length) return go(n, { at: ch[i + 1].start })
      const k = nextAvailable(n, 1)
      if (k) go(k, { at: 0 })
    },
    prevChunk: () => {
      const { surah: n, chunks: ch } = S.current
      const i = chunkAt(ch, engine.time)
      if (engine.time - ch[i].start > 3 || (i === 0 && !nextAvailable(n, -1))) return go(n, { at: ch[i].start })
      if (i > 0) return go(n, { at: ch[i - 1].start })
      const k = nextAvailable(n, -1)
      const pc = S.current.chunksOf(k)
      go(k, { at: pc[pc.length - 1].start })
    },
    nextSurah: () => { const k = nextAvailable(S.current.surah, 1); if (k) go(k) },
    // "2", "baqarah", "البقرة" → surah; "2:255" → the chunk containing that verse
    jump: (query) => {
      const v = query.trim().match(/^(\d+):(\d+)$/)
      if (v) {
        const n = parseInt(v[1], 10), a = parseInt(v[2], 10)
        if (n < 1 || n > 114) return false
        const hit = S.current.chunksOf(n).find((c) => c.vFrom && c.vTo && a >= c.vFrom && a <= c.vTo)
        go(n, { at: hit ? hit.start : 0 })
        return true
      }
      const r = matchSurahs(query).find((x) => S.current.lib?.audio.has(x.n))
      if (r) go(r.n)
      return !!r
    },
    loopChunk: () => C.current.changeLoop(S.current.loop === 'chunk' ? 'off' : 'chunk'),
    prevSurah: () => {
      const { surah: n } = S.current
      if (engine.time > 5) return go(n)
      const k = nextAvailable(n, -1); if (k) go(k)
    },
  }
  const A = useRef(actions)
  A.current = actions

  useEffect(() => {
    const offs = [
      engine.on('time', () => setTime(engine.time)),
      engine.on('unit', () => setTime(engine.time)),
      engine.on('state', () => setPlaying(engine.playing)),
      engine.on('error', () => setError('Playback error — is the file readable?')),
      engine.on('ended', () => {
        const st = S.current, u = unitRef.current
        if (!u) return
        playsRef.current += 1
        const loops = u.kind === 'range' || (u.kind === st.loop)
        const target = st.repeat || Infinity
        if (loops && playsRef.current < target) {
          gapTimer.current = setTimeout(() => engine.replay(), st.gap * 1000)
          return
        }
        if (st.stopAfter === u.kind) { setStopAfter('never'); playsRef.current = 0; return }
        if (u.kind === 'range') { playsRef.current = 0; return }
        const advance = () => {
          if (u.kind === 'chunk' && u.chunk + 1 < st.chunks.length) return go(u.surah, { at: st.chunks[u.chunk + 1].start })
          if (st.stopAfter === 'surah') { setStopAfter('never'); return }
          const k = nextAvailable(u.surah, 1)
          if (k) go(k, { at: 0 })
        }
        // pause between repeated units also applies before moving on when looping
        if (loops && st.gap) gapTimer.current = setTimeout(advance, st.gap * 1000)
        else advance()
      }),
    ]
    return () => offs.forEach((f) => f())
  }, [engine, go])

  useEffect(() => () => { engine.pause() }, [engine])
  useEffect(() => { playsRef.current = 0 }, [repeat])

  // changing loop mode / stop-after / range rebuilds the unit around the current position
  const rebuild = (over, at) => {
    if (engine.hasUnit) go(S.current.surah, { at: at ?? engine.time, play: engine.playing, ...over })
  }
  const changeLoop = (k, at) => {
    let r = S.current.range
    if (k === 'range' && !r) {
      const i = chunkAt(S.current.chunks, engine.time)
      r = { from: i, to: Math.min(i + 1, S.current.chunks.length - 1) }
      setRange(r)
    }
    setLoop(k)
    rebuild({ loop: k, range: r }, at)
  }
  const changeStop = (v) => { setStopAfter(v); rebuild({ stopAfter: v }) }
  const changeRange = (r) => { setRange(r); rebuild({ range: r }, S.current.chunks[r.from].start) }
  const C = useRef(null)
  C.current = { changeLoop }
  // marker layer switch: chunks change after render, then rebuild
  const firstLayer = useRef(true)
  useEffect(() => {
    if (firstLayer.current) { firstLayer.current = false; return }
    rebuild({})
  }, [layer]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- library ----------
  const openIt = useCallback(async (c) => {
    try {
      const l = await openLibrary(c)
      setLib(l); setStatus('ready'); setError(null)
      if (layer >= l.layers.length) setLayer(0)
      if (c.audio.kind === 'dir') {
        const est = {}
        for (const s of SURAHS) {
          if (!l.audio.has(s.n)) continue
          try { est[s.n] = await estimateDuration(await l.audio.getBlob(s.n)) } catch { /* ignore */ }
        }
        setDurations((x) => ({ ...est, ...x }))
      }
    } catch (e) {
      setError(e.message); setStatus('setup')
    }
  }, [layer])

  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(window.location.search)
      let c
      if (q.get('audio')) {
        c = { audio: { kind: 'url', base: q.get('audio') }, layers: q.getAll('markers').map((b) => ({ kind: 'url', base: b, name: urlName(b) })) }
        await saveConfig(c)
      } else c = await loadConfig()
      if (!c?.audio) { setStatus('setup'); setCfg(c); return }
      setCfg(c)
      if ((await permissionState(c)) !== 'granted') { setStatus('reconnect'); return }
      openIt(c)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // restore last position (paused) once the library is open
  const restored = useRef(false)
  useEffect(() => {
    if (!lib || restored.current) return
    restored.current = true
    const n = lib.audio.has(saved.surah) ? saved.surah : SURAHS.find((s) => lib.audio.has(s.n))?.n
    if (n) go(n, { at: n === saved.surah ? saved.time || 0 : 0, play: false })
  }, [lib]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateCfg = async (c) => {
    setCfg(c); await saveConfig(c)
    if (c.audio) openIt(c)
  }
  const chooseAudio = async () => {
    try { const h = await pickFolder('audio'); updateCfg({ layers: [], ...cfg, audio: { kind: 'dir', handle: h } }) } catch { /* cancelled */ }
  }
  const addLayer = async () => {
    try {
      const h = await pickFolder('markers')
      updateCfg({ ...cfg, layers: [...(cfg?.layers || []), { kind: 'dir', handle: h, name: h.name }] })
    } catch { /* cancelled */ }
  }
  const removeLayer = (i) => updateCfg({ ...cfg, layers: cfg.layers.filter((_, k) => k !== i) })
  const reconnect = async () => {
    if ((await permissionState(cfg, true)) === 'granted') openIt(cfg)
  }
  const useUrls = () => {
    if (!urlForm.audio.trim()) return
    const layers = urlForm.markers.split(/[\s,]+/).filter(Boolean).map((b) => ({ kind: 'url', base: b, name: urlName(b) }))
    updateCfg({ audio: { kind: 'url', base: urlForm.audio.trim() }, layers })
  }

  // ---------- persistence, sleep timer, media session, keyboard ----------
  useEffect(() => {
    const id = setInterval(() => {
      const st = S.current
      saveState({ surah: st.surah, time: engine.hasUnit ? engine.time : st.time, layer, loop, repeat, gap, speed })
    }, 2000)
    return () => clearInterval(id)
  }, [engine, layer, loop, repeat, gap, speed])

  useEffect(() => {
    if (!sleepAt) return
    const id = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= sleepAt) { engine.pause(); setSleepAt(null) }
    }, 1000)
    return () => clearInterval(id)
  }, [sleepAt, engine])

  const label = chunk?.label || (chunks.length > 1 ? `Part ${ci + 1}` : info.tr)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: `${info.tr} · ${label}`,
      artist: chunks.length > 1 ? `Chunk ${ci + 1} of ${chunks.length}` : `Surah ${surah}`,
      album: lib?.layers[layer]?.name || 'Recitation',
    })
  }, [surah, ci, label, chunks.length, info.tr, lib, layer])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn) } catch { /* unsupported */ } }
    set('play', () => A.current.toggle())
    set('pause', () => engine.pause())
    set('nexttrack', () => A.current.nextChunk())
    set('previoustrack', () => A.current.prevChunk())
    set('seekforward', () => A.current.seekBy(10))
    set('seekbackward', () => A.current.seekBy(-10))
    set('seekto', (d) => A.current.seekTo((engine.unit?.offset || 0) + d.seekTime))
  }, [engine])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape') e.target.blur?.()
        return
      }
      const a = A.current
      const map = {
        ' ': a.toggle,
        ArrowLeft: () => a.seekBy(e.shiftKey ? -30 : -5),
        ArrowRight: () => a.seekBy(e.shiftKey ? 30 : 5),
        ArrowUp: a.prevChunk,
        ArrowDown: a.nextChunk,
        '[': a.prevSurah,
        ']': a.nextSurah,
        l: a.loopChunk,
        L: a.loopChunk,
        '/': () => searchRef.current?.focus(),
        '-': () => setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)] ?? 1),
        '=': () => setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)] ?? 1),
      }
      const fn = map[e.key]
      if (fn) { e.preventDefault(); fn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // keep the current chunk / surah visible inside their own scroll boxes (never scroll the page)
  const reveal = (box, el) => {
    if (!box || !el) return
    const b = box.getBoundingClientRect(), r = el.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop -= b.top - r.top + 8
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8
  }
  const sideRef = useRef(null)
  useEffect(() => { reveal(listRef.current, listRef.current?.querySelector('.pl-chunk.current')) }, [ci, surah])
  useEffect(() => { reveal(sideRef.current, sideRef.current?.querySelector('.pl-surah.current')) }, [surah, status])

  // ---------- search ----------
  const results = useMemo(() => matchSurahs(query), [query])

  const onSearchEnter = () => {
    A.current.jump(query)
    setQuery(''); searchRef.current?.blur()
  }

  // ---------- remote control (extension popup / keyboard commands) ----------
  useEffect(() => {
    const rt = globalThis.chrome?.runtime
    if (!rt?.onMessage) return
    const snapshot = () => {
      const st = S.current, ch = st.chunks, t = engine.hasUnit ? engine.time : st.time
      const u = unitRef.current
      const i = u?.kind === 'chunk' && u.surah === st.surah && u.chunk < ch.length ? u.chunk : chunkAt(ch, t)
      const total = durationsRef.current[st.surah] ?? null
      const c = ch[i]
      return {
        ready: !!st.lib, surah: st.surah, tr: SURAHS[st.surah - 1].tr, ar: SURAHS[st.surah - 1].ar,
        chunk: i, chunks: ch.length, label: c?.label || null, start: c?.start ?? 0, end: c?.end ?? total,
        time: t, total, playing: engine.playing, loop: st.loop,
      }
    }
    const onMsg = (msg, _sender, reply) => {
      if (msg?.to !== 'player') return
      if (msg.cmd && typeof A.current[msg.cmd] === 'function') A.current[msg.cmd](...(msg.args || []))
      reply(snapshot())
    }
    rt.onMessage.addListener(onMsg)
    return () => rt.onMessage.removeListener(onMsg)
  }, [engine])

  // tab title doubles as a now-playing line (pinned tab tooltip, window switcher)
  useEffect(() => {
    document.title = playing ? `▶ ${info.tr} · ${chunk?.label || `chunk ${ci + 1}`}` : 'Recitation Player'
  }, [playing, info.tr, chunk?.label, ci])

  // ---------- render ----------
  if (status === 'loading') return <div className="pl-shell"><p className="pl-muted">Loading…</p></div>

  if (status === 'setup' || status === 'reconnect') {
    return (
      <div className="pl-shell">
        <Header embedded={embedded} />
        <div className="pl-setup">
          {status === 'reconnect' ? (
            <>
              <h2>Welcome back</h2>
              <p>Chrome needs one click to re-open your folders.</p>
              <button className="pl-btn pl-primary" onClick={reconnect}>Reconnect folders</button>
              <p className="pl-muted">Tip: choose “Allow on every visit” and this step disappears.</p>
            </>
          ) : (
            <>
              <h2>Set up your library</h2>
              <ol className="pl-steps">
                <li>
                  <strong>Audio folder</strong> — files named <code>001.mp3</code> … <code>114.mp3</code>
                  <div><button className="pl-btn pl-primary" disabled={!canPickFolders} onClick={chooseAudio}>Choose audio folder</button></div>
                </li>
                <li>
                  <strong>Marker folders</strong> (optional, add later too) — <code>002.json</code> files exported from the splitter
                </li>
              </ol>
              {!canPickFolders && <p className="pl-warn">This browser can’t open local folders — use Chrome, or a URL below.</p>}
              <details className="pl-urls">
                <summary>…or load from a URL (any static server)</summary>
                <input placeholder="Audio base URL, e.g. http://localhost:8000/alafasy" value={urlForm.audio} onChange={(e) => setUrlForm({ ...urlForm, audio: e.target.value })} />
                <input placeholder="Marker base URL(s), space separated (optional)" value={urlForm.markers} onChange={(e) => setUrlForm({ ...urlForm, markers: e.target.value })} />
                <button className="pl-btn" onClick={useUrls}>Use URLs</button>
              </details>
            </>
          )}
          {error && <p className="pl-error">{error}</p>}
        </div>
      </div>
    )
  }

  const total = duration || chunks[chunks.length - 1]?.end || null
  const chunkLen = chunk && (chunk.end ?? total) != null ? (chunk.end ?? total) - chunk.start : null
  const maxLen = Math.max(...chunks.map((c) => ((c.end ?? total) || 0) - c.start), 1)
  const layerName = lib?.layers[layer]?.name

  return (
    <div className="pl-shell">
      <Header embedded={embedded} />
      <div className="pl-layout">
        <aside className="pl-side">
          <input
            ref={searchRef}
            className="pl-search"
            placeholder="Search: 2, baqarah, البقرة, 2:255   ( / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearchEnter() }}
          />
          <div className="pl-surahs" ref={sideRef}>
            {results.map((s) => {
              const has = lib?.audio.has(s.n)
              const nm = markersOf(s.n)?.length
              return (
                <button key={s.n} className={`pl-surah${s.n === surah ? ' current' : ''}`} disabled={!has} onClick={() => go(s.n)}>
                  <span className="pl-num">{s.n}</span>
                  <span className="pl-names">
                    <span className="pl-tr">{s.tr}</span>
                    <span className="pl-meta">{nm ? `${nm + 1} chunks · ` : ''}{durations[s.n] ? fmt(durations[s.n]) : `${s.ayas} verses`}</span>
                  </span>
                  <span className="pl-ar" lang="ar">{s.ar}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <main className="pl-main">
          <section className="pl-now">
            <div className="pl-title">
              <div>
                <div className="pl-kicker">Surah {surah} · {info.en} · {info.ayas} verses</div>
                <h2>{info.tr}</h2>
              </div>
              <div className="pl-ar-big" lang="ar">{info.ar}</div>
            </div>
            <div className="pl-chunkline">
              {chunks.length > 1 ? <span className="pl-pill">Chunk {ci + 1} / {chunks.length}</span> : <span className="pl-pill">Whole surah</span>}
              {chunk?.label && <span className="pl-verses">{chunk.label}</span>}
              {chunkLen != null && <span className="pl-muted">{fmt(time - chunk.start)} / {fmt(chunkLen)}</span>}
              {busy && <span className="pl-muted">loading…</span>}
            </div>

            <div className="pl-timeline" onClick={(e) => {
              if (!total) return
              const r = e.currentTarget.getBoundingClientRect()
              A.current.seekTo(((e.clientX - r.left) / r.width) * total)
            }}>
              {chunks.map((c, i) => {
                const end = c.end ?? total
                const w = total && end ? ((end - c.start) / total) * 100 : 100 / chunks.length
                const inRange = loop === 'range' && range && i >= range.from && i <= range.to
                return (
                  <div key={i} className={`pl-band${i === ci ? ' current' : ''}${inRange ? ' range' : ''}`} style={{ width: `${w}%` }}
                    title={`${c.label || `Chunk ${i + 1}`} · ${fmt(c.start)} → ${fmt(end)} (${fmtDur(end - c.start)})`}>
                    {w > 3 && <span>{i + 1}</span>}
                  </div>
                )
              })}
              {total && <div className="pl-head" style={{ left: `${Math.min(100, (time / total) * 100)}%` }} />}
            </div>
            <div className="pl-times"><span>{fmt(time)}</span><span>{fmt(total)}</span></div>

            <div className="pl-transport">
              <button className="pl-icon" title="Previous surah  [" onClick={() => A.current.prevSurah()}>⏮</button>
              <button className="pl-icon" title="Previous chunk  ↑" onClick={() => A.current.prevChunk()}>⇤</button>
              <button className="pl-icon" title="Back 5 s  ←  (Shift: 30 s)" onClick={() => A.current.seekBy(-5)}>↺5</button>
              <button className="pl-play" title="Play / pause  Space" onClick={() => A.current.toggle()}>{playing ? '❚❚' : '▶'}</button>
              <button className="pl-icon" title="Forward 5 s  →  (Shift: 30 s)" onClick={() => A.current.seekBy(5)}>5↻</button>
              <button className="pl-icon" title="Next chunk  ↓" onClick={() => A.current.nextChunk()}>⇥</button>
              <button className="pl-icon" title="Next surah  ]" onClick={() => A.current.nextSurah()}>⏭</button>
            </div>

            <div className="pl-options">
              <div className="pl-seg" role="group" aria-label="Loop">
                {[['off', 'No loop'], ['chunk', 'Loop chunk'], ['surah', 'Loop surah'], ['range', 'Loop range']].map(([k, t]) => (
                  <button key={k} className={loop === k ? 'on' : ''} onClick={() => changeLoop(k)}>{t}</button>
                ))}
              </div>
              {loop !== 'off' && (
                <label className="pl-field">Repeat
                  <select value={repeat} onChange={(e) => setRepeat(+e.target.value)}>
                    {REPEATS.map((r) => <option key={r} value={r}>{r ? `×${r} then next` : '∞'}</option>)}
                  </select>
                </label>
              )}
              {loop !== 'off' && (
                <label className="pl-field">Pause between
                  <select value={gap} onChange={(e) => setGap(+e.target.value)}>
                    {GAPS.map((g) => <option key={g} value={g}>{g ? `${g} s` : 'none'}</option>)}
                  </select>
                </label>
              )}
              <label className="pl-field">Speed
                <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
                  {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                </select>
              </label>
              <label className="pl-field">Stop
                <select value={sleepAt ? 'timer' : stopAfter} onChange={(e) => {
                  const v = e.target.value
                  if (/^\d+$/.test(v)) { setSleepAt(Date.now() + v * 60000); if (stopAfter !== 'never') changeStop('never') }
                  else { setSleepAt(null); changeStop(v) }
                }}>
                  <option value="never">never</option>
                  <option value="chunk">after this chunk</option>
                  <option value="surah">after this surah</option>
                  {SLEEP.map((m) => <option key={m} value={m}>in {m} min</option>)}
                  {sleepAt && <option value="timer">in {fmt((sleepAt - now) / 1000)}</option>}
                </select>
              </label>
              {lib?.layers.length > 0 && (
                <label className="pl-field">Markers
                  <select value={layer} onChange={(e) => setLayer(+e.target.value)}>
                    {lib.layers.map((l, i) => <option key={i} value={i}>{l.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {loop === 'range' && range && chunks.length > 1 && (
              <div className="pl-range">
                Loop from
                <select value={range.from} onChange={(e) => { const f = +e.target.value; changeRange({ from: f, to: Math.max(f, range.to) }) }}>
                  {chunks.map((c, i) => <option key={i} value={i}>{i + 1}. {c.label || fmt(c.start)}</option>)}
                </select>
                to
                <select value={range.to} onChange={(e) => { const t = +e.target.value; changeRange({ from: Math.min(range.from, t), to: t }) }}>
                  {chunks.map((c, i) => <option key={i} value={i}>{i + 1}. {c.label || fmt(c.start)}</option>)}
                </select>
              </div>
            )}
            {error && <p className="pl-error">{error}</p>}
          </section>

          <section className="pl-chunks" ref={listRef}>
            <div className="pl-chunks-head">
              <h3>{chunks.length > 1 ? `${chunks.length} chunks` : 'No markers for this surah'}{layerName ? <span className="pl-muted"> · {layerName}</span> : null}</h3>
            </div>
            {chunks.map((c, i) => {
              const end = c.end ?? total
              const len = end != null ? end - c.start : null
              return (
                <div key={i} className={`pl-chunk${i === ci ? ' current' : ''}`} onClick={() => A.current.chunk(surah, i)}>
                  <span className="pl-idx">{i + 1}</span>
                  <span className="pl-clabel">{c.label || (chunks.length > 1 ? `Chunk ${i + 1}` : info.tr)}</span>
                  <span className="pl-ctime">{fmt(c.start)} → {fmt(end)}</span>
                  <span className="pl-clen">
                    <span className="pl-lenbar" style={{ width: len ? `${(len / maxLen) * 100}%` : 0 }} />
                    <span className="pl-lentxt">{fmtDur(len)}</span>
                  </span>
                  <button className="pl-mini" title="Loop this chunk" onClick={(e) => {
                    e.stopPropagation(); setLoop('chunk'); go(surah, { at: c.start, loop: 'chunk' })
                  }}>🔁</button>
                </div>
              )
            })}
          </section>

          <details className="pl-settings">
            <summary>Library &amp; shortcuts</summary>
            <div className="pl-settings-body">
              <p><strong>Audio:</strong> {cfg?.audio?.kind === 'dir' ? cfg.audio.handle.name : cfg?.audio?.base} {canPickFolders && <button className="pl-btn" onClick={chooseAudio}>Change</button>}</p>
              <p><strong>Markers:</strong> {cfg?.layers?.length ? cfg.layers.map((l, i) => (
                <span key={i} className="pl-tag">{l.name} <button onClick={() => removeLayer(i)} title="Remove">×</button></span>
              )) : 'none'} {canPickFolders && <button className="pl-btn" onClick={addLayer}>+ Add marker folder</button>}</p>
              <p className="pl-keys">
                <kbd>Space</kbd> play/pause · <kbd>←</kbd>/<kbd>→</kbd> 5 s (<kbd>Shift</kbd> 30 s) · <kbd>↑</kbd>/<kbd>↓</kbd> prev/next chunk ·
                <kbd>[</kbd>/<kbd>]</kbd> prev/next surah · <kbd>L</kbd> loop chunk · <kbd>/</kbd> search · <kbd>-</kbd>/<kbd>=</kbd> speed ·
                media keys: play/pause, next/prev chunk
              </p>
            </div>
          </details>
        </main>
      </div>
    </div>
  )
}

function Header({ embedded }) {
  return (
    <header className="pl-header">
      <h1>Recitation Player</h1>
      {!embedded && <a href="/" className="pl-link">← Splitter</a>}
    </header>
  )
}
