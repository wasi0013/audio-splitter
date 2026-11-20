// Library = an audio folder (001.mp3 … 114.mp3) + marker folders (SSS.json), from local folders
// (File System Access API, remembered in IndexedDB) or from an http base URL (any static server).
import SURAHS from './surahs.json'

export { SURAHS }

export const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '').replace(/^(al|an|ar|as|at|ad|adh|az|ash)[- ']/, '').replace(/[-'’ ]/g, '')

export function matchSurahs(query) {
  const q = query.trim()
  if (!q) return SURAHS
  if (/^\d+$/.test(q)) return SURAHS.filter((s) => String(s.n).startsWith(q))
  const v = q.match(/^(\d+):(\d*)$/)
  if (v) return SURAHS.filter((s) => s.n === parseInt(v[1], 10))
  const nq = norm(q)
  return SURAHS.filter((s) => norm(s.tr).includes(nq) || norm(s.en).includes(nq) || s.ar.includes(q))
}
const AUDIO_RE = /^(\d{3})\.(mp3|m4a|ogg|opus|wav|flac|aac)$/i
const MARKER_RE = /^(\d{3})\.json$/i

// ---- tiny IndexedDB key/value store (directory handles can't go in localStorage) ----
const DB = 'recitation-player'
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1)
    open.onupgradeneeded = () => open.result.createObjectStore('kv')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode)
      const req = fn(tx.objectStore('kv'))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
    }
  })
}
export const kvGet = (k) => idb('readonly', (s) => s.get(k)).catch(() => undefined)
export const kvSet = (k, v) => idb('readwrite', (s) => s.put(v, k)).catch(() => undefined)

export const canPickFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ---- config: { audio: {kind:'dir', handle} | {kind:'url', base}, layers: [{name, kind, handle|base}] } ----
export async function loadConfig() { return (await kvGet('config')) || null }
export async function saveConfig(cfg) { await kvSet('config', cfg) }

export async function pickFolder(id) {
  return window.showDirectoryPicker({ id, mode: 'read' })
}

// 'granted' | 'prompt' | 'denied' for every folder handle in the config
export async function permissionState(cfg, request = false) {
  const handles = [cfg.audio, ...cfg.layers].filter((x) => x.kind === 'dir').map((x) => x.handle)
  let state = 'granted'
  for (const h of handles) {
    let s = await h.queryPermission({ mode: 'read' })
    if (s !== 'granted' && request) s = await h.requestPermission({ mode: 'read' })
    if (s !== 'granted') state = s
  }
  return state
}

async function listDir(handle, re) {
  const out = new Map()
  for await (const [name, entry] of handle.entries()) {
    const m = entry.kind === 'file' && name.match(re)
    if (m) out.set(parseInt(m[1], 10), entry)
  }
  return out
}

const pad = (n) => String(n).padStart(3, '0')
const joinUrl = (base, name) => base.replace(/\/+$/, '') + '/' + name

// Open a library: resolves audio files, all marker layers, and returns accessors.
export async function openLibrary(cfg) {
  let audio
  if (cfg.audio.kind === 'dir') {
    const files = await listDir(cfg.audio.handle, AUDIO_RE)
    audio = {
      has: (n) => files.has(n),
      count: files.size,
      getBlob: async (n) => files.get(n).getFile(),
    }
  } else {
    const cache = new Map()
    audio = {
      has: () => true,
      count: 114,
      getBlob: async (n) => {
        if (!cache.has(n)) {
          const r = await fetch(joinUrl(cfg.audio.base, `${pad(n)}.mp3`))
          if (!r.ok) throw new Error(`${pad(n)}.mp3: HTTP ${r.status}`)
          cache.clear() // keep only one big blob in memory
          cache.set(n, await r.blob())
        }
        return cache.get(n)
      },
    }
  }

  const layers = []
  for (const l of cfg.layers) {
    const markers = new Map()
    if (l.kind === 'dir') {
      for (const [n, entry] of await listDir(l.handle, MARKER_RE)) {
        try { markers.set(n, parseMarkers(await (await entry.getFile()).text())) } catch { /* skip bad file */ }
      }
    } else {
      await Promise.all(SURAHS.map(async ({ n }) => {
        try {
          const r = await fetch(joinUrl(l.base, `${pad(n)}.json`))
          if (r.ok) markers.set(n, parseMarkers(await r.text()))
        } catch { /* missing */ }
      }))
    }
    layers.push({ name: l.name, markers })
  }
  return { audio, layers }
}

export function parseMarkers(text) {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : data.markers
  return (list || [])
    .map((m) => (typeof m === 'number' ? { time: m } : m))
    .filter((m) => typeof m.time === 'number' && m.time >= 0)
    .sort((a, b) => a.time - b.time)
}

// "2:40" → 40 (only if it belongs to surah n)
const verseOf = (from, n) => {
  const m = typeof from === 'string' && from.match(/^(\d+):(\d+)$/)
  return m && parseInt(m[1], 10) === n ? parseInt(m[2], 10) : null
}

// Chunks of surah n for a marker list; duration may be unknown (null) until the file is opened.
export function buildChunks(n, markers = [], duration = null) {
  const ayas = SURAHS[n - 1].ayas
  const starts = [{ time: 0, verse: 1 }, ...markers.map((m) => ({ time: m.time, verse: verseOf(m.from, n), note: m.note }))]
  return starts.map((s, i) => {
    const next = starts[i + 1]
    const end = next ? next.time : duration
    const vFrom = s.verse
    const vTo = next ? (next.verse ? next.verse - 1 : null) : ayas
    let label = null
    if (vFrom && vTo) label = vFrom === vTo ? `${n}:${vFrom}` : `${n}:${vFrom}–${vTo}`
    return { index: i, start: s.time, end, vFrom, vTo: vFrom && vTo ? vTo : null, label, note: s.note }
  })
}
