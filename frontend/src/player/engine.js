// Plays a "unit" = [start, end) of one surah file as an exact MP3 byte slice, so the audio element's own
// `ended` event marks the boundary (no timer polling, works in background tabs). Non-MP3 files fall back to
// seeking the whole file and stopping on timeupdate.
import { buildIndex } from './mp3Index'

export class Engine {
  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.preservesPitch = true
    this.files = new Map()   // surah → { blob, index }
    this.unit = null         // { surah, start, end, offset }  offset = real start time of the slice
    this.url = null
    this.listeners = {}
    this.loadToken = 0
    const emit = (e) => () => this.emit(e)
    this.audio.addEventListener('timeupdate', () => {
      if (this.unit?.fallback && this.unit.end != null && this.audio.currentTime >= this.unit.end) {
        this.audio.pause(); this.emit('ended'); return
      }
      this.emit('time')
    })
    this.audio.addEventListener('ended', emit('ended'))
    this.audio.addEventListener('play', emit('state'))
    this.audio.addEventListener('pause', emit('state'))
    this.audio.addEventListener('error', () => this.emit('error', this.audio.error))
  }

  on(e, fn) { (this.listeners[e] ||= new Set()).add(fn); return () => this.listeners[e].delete(fn) }
  emit(e, arg) { this.listeners[e]?.forEach((fn) => fn(arg)) }

  async open(surah, getBlob) {
    if (!this.files.has(surah)) {
      const blob = await getBlob(surah)
      const index = await buildIndex(blob)
      if (this.files.size > 2) this.files.delete(this.files.keys().next().value) // keep current + neighbours
      this.files.set(surah, { blob, index })
    }
    return this.files.get(surah)
  }

  duration(surah) {
    const f = this.files.get(surah)
    return f?.index?.duration ?? (this.unit?.surah === surah && this.unit.fallback ? this.audio.duration : null)
  }

  // Load [start, end) of `surah`; begin playback at absolute time `at` (defaults to start).
  async load(surah, getBlob, { start = 0, end = null, at = null, play = true } = {}) {
    const token = ++this.loadToken
    const { blob, index } = await this.open(surah, getBlob)
    if (token !== this.loadToken) return false
    let unit
    if (index) {
      const a = await index.locate(start)
      const b = end == null ? { byte: blob.size } : await index.locate(end)
      if (token !== this.loadToken) return false
      unit = { surah, start, end: end ?? index.duration, offset: a.time, slice: blob.slice(a.byte, b.byte, 'audio/mpeg') }
    } else {
      unit = { surah, start, end, offset: 0, slice: blob, fallback: true }
    }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = URL.createObjectURL(unit.slice)
    this.unit = unit
    this.audio.src = this.url
    const seek = Math.max(0, (at ?? start) - unit.offset)
    if (seek > 0.05) {
      await new Promise((r) => this.audio.addEventListener('loadedmetadata', r, { once: true }))
      this.audio.currentTime = seek
    }
    this.emit('unit')
    if (play) await this.audio.play().catch(() => {})
    return true
  }

  get time() { return this.unit ? this.unit.offset + this.audio.currentTime : 0 }
  get playing() { return !this.audio.paused }
  get hasUnit() { return !!this.unit }

  // seek to absolute time inside the current unit; returns false if outside (caller reloads)
  seek(t) {
    const u = this.unit
    if (!u || t < u.start - 0.05 || (u.end != null && t > u.end)) return false
    this.audio.currentTime = Math.max(0, t - u.offset)
    this.emit('time')
    return true
  }

  play() { return this.audio.play().catch(() => {}) }
  pause() { this.audio.pause() }
  set rate(r) { this.audio.defaultPlaybackRate = r; this.audio.playbackRate = r }
  set volume(v) { this.audio.volume = v }
  replay() { this.audio.currentTime = 0; return this.play() }
}
