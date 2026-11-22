// Loudness envelope of a whole surah file, for the waveform in the timeline.
// The MP3 is decoded in ~60 s frame-aligned byte slices into a low-rate OfflineAudioContext (small buffers, no
// multi-GB decode of a 2-hour file). Each slice's buckets are placed at the slice's own start time from the frame
// index, so decoder delay/padding never accumulates into drift against the markers.

export const BUCKETS_PER_SEC = 4
const SLICE = 60          // seconds per decode slice
const RATE = 8000         // decode sample rate
const FLOOR = -50         // dB mapped to 0

const cache = new Map()   // `${surah}:${size}` → { env: Uint8Array, done: true }

// returns Uint8Array (0..255 per bucket, 0 = silence); calls onProgress(env, doneSeconds) as slices finish.
// isStale() → true aborts (surah changed).
export async function computeEnvelope(surah, blob, index, { onProgress, isStale } = {}) {
  const key = `${surah}:${blob.size}`
  if (cache.has(key)) return cache.get(key)
  if (!index || typeof OfflineAudioContext === 'undefined') return null
  const n = Math.ceil(index.duration * BUCKETS_PER_SEC)
  const db = new Float32Array(n).fill(-120)
  const ctx = new OfflineAudioContext(1, 1, RATE)
  const per = RATE / BUCKETS_PER_SEC
  let lastByte = null, lastShown = 0
  for (let t = 0; t < index.duration; t += SLICE) {
    if (isStale?.()) return null
    const a = await index.locate(t)
    const b = t + SLICE >= index.duration ? { byte: blob.size } : await index.locate(t + SLICE)
    if (a.byte === lastByte || b.byte <= a.byte) continue
    lastByte = a.byte
    let buf
    try { buf = await ctx.decodeAudioData(await blob.slice(a.byte, b.byte).arrayBuffer()) } catch { continue }
    const x = buf.getChannelData(0)
    const k0 = Math.round(a.time * BUCKETS_PER_SEC)
    for (let k = 0; k * per < x.length && k0 + k < n; k++) {
      let s = 0
      const lo = Math.floor(k * per), hi = Math.min(x.length, Math.floor((k + 1) * per))
      for (let i = lo; i < hi; i++) s += x[i] * x[i]
      db[k0 + k] = 10 * Math.log10(s / Math.max(1, hi - lo) + 1e-12)
    }
    if (onProgress && performance.now() - lastShown > 400) { lastShown = performance.now(); onProgress(normalise(db), Math.min(index.duration, t + SLICE)) }
    await new Promise((r) => setTimeout(r, 0))   // let playback / UI breathe between slices
  }
  if (isStale?.()) return null
  const res = { env: normalise(db), done: true }
  cache.set(key, res)
  if (cache.size > 12) cache.delete(cache.keys().next().value)
  return res
}

// dB → 0..255 between FLOOR and the 95th percentile of voiced buckets (so a few loud peaks don't flatten the rest)
function normalise(db) {
  const voiced = Array.from(db).filter((v) => v > FLOOR).sort((p, q) => p - q)
  const top = voiced.length ? voiced[Math.floor(voiced.length * 0.95)] : 0
  const span = Math.max(6, top - FLOOR)
  const out = new Uint8Array(db.length)
  for (let i = 0; i < db.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(((db[i] - FLOOR) / span) * 255)))
  return out
}
