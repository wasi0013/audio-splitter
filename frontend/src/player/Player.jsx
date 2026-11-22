import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Engine } from './engine'
import { SURAHS, matchSurahs, buildChunks, canPickFolders, loadConfig, saveConfig, openLibrary, permissionState, pickFolder } from './library'
import { estimateDuration, estimateDurationUrl } from './mp3Index'
import { computeEnvelope } from './waveform'
import { fmt, fmtDur, Popover, Choice, Dialog, Timeline, useToast } from './ui'
import * as I from './icons'
import './player.css'

const LS = 'recitation-player:state'
const loadState = () => { try { return JSON.parse(localStorage.getItem(LS)) || {} } catch { return {} } }
const saveState = (s) => { try { localStorage.setItem(LS, JSON.stringify(s)) } catch { /* private mode */ } }

// what one chunk is called, from the marker layer's name ("rakahs" → Rak'ah)
const unitNames = (layerName = '') => {
  const n = layerName.toLowerCase()
  if (/rak/.test(n)) return ['Rak’ah', 'rak’ahs']
  if (/page/.test(n)) return ['Page', 'pages']
  if (/juz|para/.test(n)) return ['Juz', 'juz']
  if (/ruku/.test(n)) return ['Ruku', 'rukus']
  return ['Part', 'parts']
}
const plural = (n, [one, many]) => `${n} ${n === 1 ? one.toLowerCase() : many}`
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
  const [rangePick, setRangePick] = useState(null)             // null | 'start' | { from } while choosing a loop range
  const [dialog, setDialog] = useState(null)                   // null | 'help' | 'library'
  const [drawer, setDrawer] = useState(false)                  // surah list on small screens
  const [starts, setStarts] = useState(null)                   // opening words per verse, lazy-loaded
  const [toastNode, toast] = useToast()
  const T = useRef(toast)
  T.current = toast

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
  const UN = unitNames(lib?.layers[layer]?.name)

  // latest values for event handlers
  const S = useRef({})
  S.current = { surah, chunks, chunksOf, loop, repeat, gap, stopAfter, range, lib, time, UN }

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
    loopChunk: () => {
      const on = S.current.loop !== 'chunk'
      C.current.changeLoop(on ? 'chunk' : 'off')
      T.current(on ? `Repeating this ${S.current.UN[0].toLowerCase()}` : 'Repeat off')
    },
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

  // loudness curve for the timeline: computed from the blob the engine already holds (never a second download)
  const [wave, setWave] = useState(null)                       // { surah, env, upTo }
  const waveFor = useRef(null)
  useEffect(() => engine.on('unit', () => {
    const n = engine.unit?.surah, f = engine.files.get(n)
    if (!f?.index || waveFor.current === n) return
    waveFor.current = n
    setWave(null)
    const stale = () => waveFor.current !== n
    computeEnvelope(n, f.blob, f.index, {
      isStale: stale,
      onProgress: (env, upTo) => { if (!stale()) setWave({ surah: n, env, upTo }) },
    }).then((r) => { if (r && !stale()) setWave({ surah: n, env: r.env, upTo: f.index.duration }) })
      .catch(() => {})
  }), [engine])
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
      } else {
        const todo = SURAHS.map((s) => s.n)
        const worker = async () => {
          for (let n; (n = todo.shift()) != null;) {
            const d = await estimateDurationUrl(c.audio.base, n).catch(() => null)
            if (d) setDurations((x) => (x[n] ? x : { ...x, [n]: d }))
          }
        }
        Promise.all([worker(), worker(), worker(), worker()])
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
    if (n && n === saved.surah && saved.time > 5) T.current(`Resume ${SURAHS[n - 1].tr} at ${fmt(saved.time)} — press Space`)
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

  const label = chunk?.label || (chunks.length > 1 ? `${UN[0]} ${ci + 1}` : info.tr)
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: `${info.tr} · ${label}`,
      artist: chunks.length > 1 ? `${UN[0]} ${ci + 1} of ${chunks.length}` : `Surah ${surah}`,
      album: lib?.layers[layer]?.name || 'Recitation',
    })
  }, [surah, ci, label, chunks.length, info.tr, lib, layer, UN])
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

  const stepSpeed = (d) => setSpeed((sp) => {
    const v = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, SPEEDS.indexOf(sp) + d))] ?? 1
    T.current(`Speed ${v}×`)
    return v
  })
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) {
        if (e.key === 'Escape') e.target.blur?.()
        return
      }
      if (document.querySelector('dialog[open]') && e.key !== '?') return
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
        '-': () => stepSpeed(-1),
        '=': () => stepSpeed(1),
        '+': () => stepSpeed(1),
        '?': () => setDialog((d) => (d === 'help' ? null : 'help')),
        s: () => setDrawer((d) => !d),
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
        time: t, total, playing: engine.playing, loop: st.loop, unit: st.UN[0],
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
    document.title = playing ? `▶ ${info.tr} · ${chunk?.label || `${UN[0]} ${ci + 1}`}` : 'Recitation Player'
  }, [playing, info.tr, chunk?.label, ci, UN])

  // opening words of every verse (for chunk rows and the timeline tooltip), loaded after first paint
  useEffect(() => { import('./verseStarts.json').then((m) => setStarts(m.default)).catch(() => {}) }, [])
  const opening = useCallback((c) => (c?.vFrom && starts ? starts[surah - 1]?.[c.vFrom - 1] : null), [starts, surah])


  // ---------- view helpers ----------
  const rowLabel = (c, i) => c?.label || (chunks.length > 1 ? `${UN[0]} ${i + 1}` : info.tr)
  const pickRow = (i, e) => {
    const from = rangePick?.from ?? (e?.shiftKey ? (loop === 'range' && range ? range.from : ci) : null)
    if (rangePick === 'start') { setRangePick({ from: i }); return }
    if (from != null && (rangePick || e?.shiftKey)) {
      const r = { from: Math.min(from, i), to: Math.max(from, i) }
      setRangePick(null); setRange(r); setLoop('range')
      go(surah, { at: chunks[r.from].start, loop: 'range', range: r })
      toast(`Repeating ${UN[1]} ${r.from + 1}–${r.to + 1}`)
      return
    }
    A.current.chunk(surah, i)
  }
  const loopThis = (i) => {
    if (loop === 'chunk' && i === ci) { changeLoop('off'); toast('Repeat off'); return }
    setLoop('chunk'); go(surah, { at: chunks[i].start, loop: 'chunk' })
    toast(`Repeating ${rowLabel(chunks[i], i)}`)
  }
  const hearJoin = (i) => {
    if (loop === 'chunk' || loop === 'range') setLoop('off')
    if (stopAfter !== 'never') setStopAfter('never')
    go(surah, { at: Math.max(0, chunks[i].start - 3), loop: 'off', stopAfter: 'never' })
    toast(`Playing 3 s before ${rowLabel(chunks[i], i)}`)
  }
  const libName = cfg?.audio ? (cfg.audio.kind === 'dir' ? cfg.audio.handle.name : urlName(cfg.audio.base)) : null

  // ---------- render ----------
  if (status === 'loading') {
    return <div className="pl-shell pl-center"><div className="pl-spinner" aria-label="Loading" /></div>
  }

  if (status === 'setup' || status === 'reconnect') {
    return (
      <div className="pl-shell">
        <Header embedded={embedded} />
        <div className="pl-setup">
          {status === 'reconnect' ? (
            <>
              <h2>Welcome back</h2>
              <p className="pl-muted">Chrome needs one click to open your folders again.</p>
              <button className="pl-btn pl-primary" onClick={reconnect}><I.Folder size={18} /> Reconnect folders</button>
              <p className="pl-muted pl-small">Tip: choose “Allow on every visit” and this step goes away.</p>
            </>
          ) : (
            <>
              <h2>Set up your library</h2>
              <p className="pl-muted">Your files stay on this computer. Nothing is uploaded.</p>
              <ol className="pl-steps">
                <li>
                  <div><strong>Audio folder</strong><span className="pl-muted"> — <code>001.mp3</code> … <code>114.mp3</code></span></div>
                  <button className="pl-btn pl-primary" disabled={!canPickFolders} onClick={chooseAudio}><I.Folder size={18} /> Choose audio folder</button>
                </li>
                <li>
                  <div><strong>Marker folders</strong><span className="pl-muted"> (optional, you can add them later) — <code>002.json</code> … exported from the splitter</span></div>
                </li>
              </ol>
              {!canPickFolders && <p className="pl-warn">This browser can’t open local folders. Use Chrome, or load from a URL below.</p>}
              <details className="pl-urls">
                <summary>Load from a URL instead (any static server)</summary>
                <input aria-label="Audio base URL" placeholder="Audio base URL, e.g. http://localhost:8000/alafasy" value={urlForm.audio} onChange={(e) => setUrlForm({ ...urlForm, audio: e.target.value })} />
                <input aria-label="Marker base URLs" placeholder="Marker base URL(s), space separated (optional)" value={urlForm.markers} onChange={(e) => setUrlForm({ ...urlForm, markers: e.target.value })} />
                <button className="pl-btn" onClick={useUrls}>Use these URLs</button>
              </details>
            </>
          )}
          {error && <p className="pl-error">{error}</p>}
        </div>
      </div>
    )
  }

  const total = duration || chunks[chunks.length - 1]?.end || null
  const chunkEnd = chunk ? (chunk.end ?? total) : null
  const chunkLen = chunk && chunkEnd != null ? chunkEnd - chunk.start : null
  const chunkPos = chunk ? Math.max(0, time - chunk.start) : 0
  const maxLen = Math.max(...chunks.map((c) => ((c.end ?? total) || 0) - c.start), 1)
  const layerName = lib?.layers[layer]?.name
  const multi = chunks.length > 1
  const unitLine = multi ? `${UN[0]} ${ci + 1} of ${chunks.length}` : 'Whole surah'
  const openWords = opening(chunk)
  const repeatText = loop === 'off' ? 'Repeat' : `${loop === 'chunk' ? UN[0] : loop === 'surah' ? 'Surah' : 'Range'}${repeat ? ` ×${repeat}` : ''}`
  const sleepText = sleepAt ? fmt((sleepAt - now) / 1000) : stopAfter === 'chunk' ? `End of ${UN[0].toLowerCase()}` : stopAfter === 'surah' ? 'End of surah' : 'Sleep'

  return (
    <div className="pl-shell pl-app">
      <Header embedded={embedded} libName={libName} layerName={layerName} onMenu={() => setDrawer(true)} onHelp={() => setDialog('help')} onLibrary={() => setDialog('library')} />
      <div className="pl-layout">
        {drawer && <div className="pl-backdrop" onClick={() => setDrawer(false)} />}
        <aside className={`pl-side${drawer ? ' open' : ''}`} aria-label="Surahs">
          <div className="pl-searchbox">
            <I.Search size={16} />
            <input
              ref={searchRef}
              className="pl-search"
              aria-label="Search surahs or go to a verse"
              placeholder="Search surah, or 2:255"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { onSearchEnter(); setDrawer(false) } }}
            />
            <kbd className="pl-kbd-hint">/</kbd>
          </div>
          <div className="pl-surahs" ref={sideRef}>
            {results.map((s) => {
              const has = lib?.audio.has(s.n)
              const nm = markersOf(s.n)?.length
              return (
                <button key={s.n} className={`pl-surah${s.n === surah ? ' current' : ''}`} disabled={!has} aria-current={s.n === surah ? 'true' : undefined}
                  onClick={() => { go(s.n); setDrawer(false) }}>
                  <span className="pl-num">{s.n}</span>
                  <span className="pl-names">
                    <span className="pl-tr">{s.tr}</span>
                    <span className="pl-meta">{nm ? `${plural(nm + 1, UN)} · ` : ''}{durations[s.n] ? fmt(durations[s.n]) : `${s.ayas} verses`}</span>
                  </span>
                  <span className="pl-ar" lang="ar">{s.ar}</span>
                </button>
              )
            })}
            {!results.length && <p className="pl-muted pl-empty">No surah matches “{query}”.</p>}
          </div>
        </aside>

        <main className="pl-main">
          <section className="pl-hero">
            <div className="pl-title">
              <div className="pl-title-text">
                <div className="pl-kicker">Surah {surah} · {info.en} · {info.ayas} verses</div>
                <h2>{info.tr}</h2>
              </div>
              <div className="pl-ar-big" lang="ar">{info.ar}</div>
            </div>
            <div className="pl-chunkline">
              <span className="pl-pill">{unitLine}</span>
              {chunk?.label && <span className="pl-verses">{chunk.label}</span>}
              {openWords && <span className="pl-opening" lang="ar" dir="rtl">{openWords}</span>}
              {chunkLen != null && <span className="pl-muted pl-tabular">{fmt(chunkPos)} / {fmt(chunkLen)}</span>}
            </div>
            <Timeline chunks={chunks} total={total} time={time} ci={ci} range={loop === 'range' ? range : null} busy={busy}
              unitName={UN[0]} starts={opening} onSeek={(t) => A.current.seekTo(t)}
              wave={wave?.surah === surah ? wave : null} />
            {error && <p className="pl-error" role="alert">{error}</p>}
          </section>

          <section className="pl-list" aria-label={multi ? UN[1] : 'Surah'}>
            <div className="pl-list-head">
              <h3>{multi ? plural(chunks.length, UN) : 'No markers for this surah'}</h3>
              {lib?.layers.length > 1 ? (
                <label className="pl-layer">Markers
                  <select value={layer} onChange={(e) => setLayer(+e.target.value)}>
                    {lib.layers.map((l, i) => <option key={i} value={i}>{l.name}</option>)}
                  </select>
                </label>
              ) : layerName ? <span className="pl-muted pl-small">{layerName}</span> : null}
              <span className="pl-grow" />
              {multi && loop === 'range' && range && !rangePick && (
                <span className="pl-rangechip">Repeating {UN[1]} {range.from + 1}–{range.to + 1}
                  <button aria-label="Stop repeating the range" onClick={() => { changeLoop('off'); toast('Repeat off') }}><I.X size={14} /></button>
                </span>
              )}
              {multi && !rangePick && (
                <button className="pl-btn pl-small-btn" onClick={() => setRangePick('start')} title="Repeat several in a row (or Shift-click a row)">
                  <I.Repeat size={16} /> Repeat a range
                </button>
              )}
            </div>
            {rangePick && (
              <div className="pl-hint" role="status">
                {rangePick === 'start' ? `Click the first ${UN[0].toLowerCase()} of the range.` : `First: ${UN[0].toLowerCase()} ${rangePick.from + 1}. Now click the last one.`}
                <button className="pl-btn pl-small-btn" onClick={() => setRangePick(null)}>Cancel</button>
              </div>
            )}
            <div className="pl-rows" ref={listRef}>
              {chunks.map((c, i) => {
                const end = c.end ?? total
                const len = end != null ? end - c.start : null
                const inRange = loop === 'range' && range && i >= range.from && i <= range.to
                const picked = rangePick?.from === i
                const lab = rowLabel(c, i)
                const words = opening(c)
                return (
                  <div key={i} className={`pl-chunk${i === ci ? ' current' : ''}${inRange ? ' range' : ''}${picked ? ' picked' : ''}${rangePick ? ' picking' : ''}`}>
                    <button className="pl-row" aria-current={i === ci ? 'true' : undefined} onClick={(e) => pickRow(i, e)}
                      aria-label={`${multi ? `${UN[0]} ${i + 1}, ` : ''}${lab}, starts at ${fmt(c.start)}, ${fmtDur(len)}`}>
                      <span className="pl-idx">{i === ci ? <I.Bars playing={playing} size={16} /> : i + 1}</span>
                      <span className="pl-clabel">{lab}</span>
                      <span className="pl-copen" lang="ar" dir="rtl">{words}</span>
                      <span className="pl-ctime">{fmt(c.start)}</span>
                      <span className="pl-clen">
                        <span className="pl-lenbar" style={{ width: len ? `${(len / maxLen) * 100}%` : 0 }} />
                        <span className="pl-lentxt">{fmtDur(len)}</span>
                      </span>
                    </button>
                    <div className="pl-rowact">
                      {i > 0 && (
                        <button className="pl-iconbtn sm" title="Hear the join: play from 3 s before this start" aria-label={`Play from 3 seconds before ${lab}`} onClick={() => hearJoin(i)}>
                          <I.Join size={17} />
                        </button>
                      )}
                      <button className={`pl-iconbtn sm${loop === 'chunk' && i === ci ? ' on' : ''}`} title={`Repeat ${lab}`} aria-label={`Repeat ${lab}`} aria-pressed={loop === 'chunk' && i === ci} onClick={() => loopThis(i)}>
                        <I.Repeat1 size={17} />
                      </button>
                    </div>
                    {i === ci && chunkLen ? <div className="pl-row-progress" style={{ width: `${Math.min(100, (chunkPos / chunkLen) * 100)}%` }} /> : null}
                  </div>
                )
              })}
            </div>
          </section>
        </main>
      </div>

      <footer className="pl-bar" aria-label="Player">
        <div className="pl-bar-progress" aria-hidden="true"><div style={{ width: chunkLen ? `${Math.min(100, (chunkPos / chunkLen) * 100)}%` : 0 }} /></div>
        <div className="pl-bar-inner">
          <div className="pl-np">
            <div className="pl-np-title">{info.tr}<span className="pl-np-ar" lang="ar">{info.ar}</span></div>
            <div className="pl-np-sub">{multi ? `${unitLine} · ` : ''}{chunk?.label || 'Whole surah'}{chunkLen != null && <span className="pl-np-clock"> · {fmt(chunkPos)} / {fmt(chunkLen)}</span>}</div>
          </div>
          <div className="pl-transport">
            <button className="pl-iconbtn pl-wide-only" aria-label="Previous surah" title="Previous surah  [" onClick={() => A.current.prevSurah()}><I.SkipBack size={18} /></button>
            <button className="pl-iconbtn" aria-label={`Previous ${UN[0].toLowerCase()}`} title={`Previous ${UN[0].toLowerCase()}  ↑`} onClick={() => A.current.prevChunk()}><I.PrevUnit /></button>
            <button className="pl-iconbtn pl-wide-only" aria-label="Back 5 seconds" title="Back 5 s  ←  (Shift: 30 s)" onClick={() => A.current.seekBy(-5)}><I.Back5 /></button>
            <button className={`pl-play${busy ? ' busy' : ''}`} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause  Space" onClick={() => A.current.toggle()}>
              {playing ? <I.Pause size={22} /> : <I.Play size={22} />}
            </button>
            <button className="pl-iconbtn pl-wide-only" aria-label="Forward 5 seconds" title="Forward 5 s  →  (Shift: 30 s)" onClick={() => A.current.seekBy(5)}><I.Fwd5 /></button>
            <button className="pl-iconbtn" aria-label={`Next ${UN[0].toLowerCase()}`} title={`Next ${UN[0].toLowerCase()}  ↓`} onClick={() => A.current.nextChunk()}><I.NextUnit /></button>
            <button className="pl-iconbtn pl-wide-only" aria-label="Next surah" title="Next surah  ]" onClick={() => A.current.nextSurah()}><I.SkipFwd size={18} /></button>
          </div>
          <div className="pl-np-time pl-tabular">{fmt(chunkPos)}<span> / {fmt(chunkLen)}</span></div>
          <div className="pl-opts">
            <Popover label="Repeat" icon={loop === 'chunk' ? <I.Repeat1 size={18} /> : <I.Repeat size={18} />} text={repeatText} active={loop !== 'off'} className="pl-pop-repeat">
              <Choice title="Repeat" value={loop} onChange={(k) => changeLoop(k)}
                options={[['off', 'Off'], ['chunk', `This ${UN[0].toLowerCase()}`], ['surah', 'This surah'], ...(multi ? [['range', 'Range']] : [])]} />
              {loop !== 'off' && <Choice title="How many times" value={repeat} onChange={setRepeat} options={REPEATS.map((r) => [r, r ? `×${r}` : '∞'])} />}
              {loop !== 'off' && <Choice title="Pause between" value={gap} onChange={setGap} options={GAPS.map((g) => [g, g ? `${g} s` : 'None'])} />}
              {loop !== 'off' && repeat > 0 && <p className="pl-panel-note">After ×{repeat}, it moves on to the next {loop === 'surah' ? 'surah' : loop === 'range' ? 'item — the range stops' : UN[0].toLowerCase()}.</p>}
              {loop === 'range' && range && multi && (
                <div className="pl-range">
                  <select aria-label="Range start" value={range.from} onChange={(e) => { const f = +e.target.value; changeRange({ from: f, to: Math.max(f, range.to) }) }}>
                    {chunks.map((c, i) => <option key={i} value={i}>{i + 1}. {rowLabel(c, i)}</option>)}
                  </select>
                  <span>to</span>
                  <select aria-label="Range end" value={range.to} onChange={(e) => { const t = +e.target.value; changeRange({ from: Math.min(range.from, t), to: t }) }}>
                    {chunks.map((c, i) => <option key={i} value={i}>{i + 1}. {rowLabel(c, i)}</option>)}
                  </select>
                </div>
              )}
            </Popover>
            <Popover label="Speed" icon={<I.Gauge size={18} />} text={speed === 1 ? '1×' : `${speed}×`} active={speed !== 1}>
              {(close) => <Choice title="Speed" value={speed} onChange={(v) => { setSpeed(v); close() }} options={SPEEDS.map((v) => [v, `${v}×`])} />}
            </Popover>
            <Popover label="Sleep timer" icon={<I.Moon size={18} />} text={sleepText} active={!!sleepAt || stopAfter !== 'never'} align="end">
              {(close) => (
                <Choice title="Stop playing" value={sleepAt ? 'timer' : stopAfter}
                  onChange={(v) => {
                    if (typeof v === 'number') { setSleepAt(Date.now() + v * 60000); if (stopAfter !== 'never') changeStop('never'); toast(`Stopping in ${v} min`) }
                    else { setSleepAt(null); changeStop(v); if (v !== 'never') toast(v === 'chunk' ? `Stopping at the end of this ${UN[0].toLowerCase()}` : 'Stopping at the end of this surah') }
                    close()
                  }}
                  options={[['never', 'Off'], ['chunk', `End of this ${UN[0].toLowerCase()}`], ['surah', 'End of this surah'], ...SLEEP.map((m) => [m, `${m} min`])]} />
              )}
            </Popover>
          </div>
        </div>
      </footer>

      <Dialog open={dialog === 'help'} onClose={() => setDialog(null)} title="Keyboard shortcuts">
        <div className="pl-keys">
          {[
            ['Space', 'Play / pause'], ['← →', 'Back / forward 5 s'], ['Shift ← →', 'Back / forward 30 s'],
            ['↑ ↓', `Previous / next ${UN[0].toLowerCase()}`], ['[ ]', 'Previous / next surah'], ['L', `Repeat this ${UN[0].toLowerCase()} on / off`],
            ['Shift-click', 'Repeat a range of rows'], ['- =', 'Slower / faster'], ['/', 'Search surahs or verses (2:255)'], ['S', 'Show surah list (small screens)'],
            ['?', 'This help'], ['Media keys', `Play / pause, previous / next ${UN[0].toLowerCase()}`],
          ].map(([k, t]) => (
            <div key={k} className="pl-keyrow"><span>{(/^[A-Z][a-z]+[- ][a-z]+$/.test(k) ? [k] : k.split(' ')).map((x, j) => <kbd key={j}>{x}</kbd>)}</span><span>{t}</span></div>
          ))}
        </div>
      </Dialog>

      <Dialog open={dialog === 'library'} onClose={() => setDialog(null)} title="Library">
        <div className="pl-libsec">
          <h3>Audio</h3>
          <div className="pl-librow">
            <I.Folder size={18} /><span className="pl-grow">{cfg?.audio?.kind === 'dir' ? cfg.audio.handle.name : cfg?.audio?.base}</span>
            {canPickFolders && <button className="pl-btn" onClick={chooseAudio}>Change</button>}
          </div>
        </div>
        <div className="pl-libsec">
          <h3>Marker folders</h3>
          {cfg?.layers?.length ? cfg.layers.map((l, i) => (
            <div key={i} className="pl-librow">
              <I.Folder size={18} /><span className="pl-grow">{l.name}{i === layer ? <span className="pl-muted"> · in use</span> : null}</span>
              <button className="pl-btn" onClick={() => removeLayer(i)}>Remove</button>
            </div>
          )) : <p className="pl-muted">None yet. Every surah plays as one piece.</p>}
          {canPickFolders && <button className="pl-btn" onClick={addLayer}>Add marker folder</button>}
        </div>
      </Dialog>

      {toastNode}
    </div>
  )
}

function Header({ embedded, libName, layerName, onMenu, onHelp, onLibrary }) {
  return (
    <header className="pl-header">
      {onMenu && <button className="pl-iconbtn pl-menu" aria-label="Surah list" onClick={onMenu}><I.List /></button>}
      <div className="pl-brand">
        <I.Logo />
        <div>
          <h1>Recitation Player</h1>
          {libName && <div className="pl-sub">{libName}{layerName ? ` · ${layerName}` : ''}</div>}
        </div>
      </div>
      <div className="pl-header-actions">
        {onHelp && <button className="pl-iconbtn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts  ?" onClick={onHelp}><I.Keyboard /></button>}
        {onLibrary && <button className="pl-iconbtn" aria-label="Library settings" title="Library" onClick={onLibrary}><I.Settings /></button>}
        {!embedded && <a href="/" className="pl-link">Splitter</a>}
      </div>
    </header>
  )
}
