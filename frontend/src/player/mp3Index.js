// Map a time (seconds) to the byte offset of the MP3 frame that starts there, so a chunk can be
// played as an exact Blob slice. CBR files are computed directly; VBR files get a one-time frame scan.

const BITRATES = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

function parseHeader(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null
  const ver = (b[i + 1] >> 3) & 3          // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[i + 1] >> 1) & 3        // 1 = Layer III
  const bri = (b[i + 2] >> 4) & 15
  const sri = (b[i + 2] >> 2) & 3
  if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null
  const mpeg1 = ver === 3
  const bitrate = BITRATES[mpeg1 ? 1 : 2][bri] * 1000
  const sampleRate = SAMPLE_RATES[ver][sri]
  const padding = (b[i + 2] >> 1) & 1
  const mono = ((b[i + 3] >> 6) & 3) === 3
  const samples = mpeg1 ? 1152 : 576
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding
  return { mpeg1, mono, bitrate, sampleRate, samples, length }
}

const bytes = async (blob, start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer())

function id3Size(b) {
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)
  return 10 + size + (b[5] & 0x10 ? 10 : 0)
}

// first offset >= from where two consecutive valid frame headers line up
function findSync(b, from = 0) {
  for (let i = from; i < b.length - 4; i++) {
    const h = parseHeader(b, i)
    if (h && (i + h.length + 4 > b.length || parseHeader(b, i + h.length))) return i
  }
  return -1
}

function tagAt(b, i, h) {
  const side = h.mpeg1 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17)
  const t = String.fromCharCode(...b.slice(i + 4 + side, i + 8 + side))
  if (t === 'Xing' || t === 'Info') return t
  return String.fromCharCode(...b.slice(i + 36, i + 40)) === 'VBRI' ? 'VBRI' : null
}

async function scanFrames(blob, dataStart) {
  const offsets = []
  const STEP = 4 << 20
  let pos = dataStart
  while (pos < blob.size - 4) {
    const b = await bytes(blob, pos, Math.min(blob.size, pos + STEP + 4096))
    let i = 0
    while (i < b.length - 4 && pos + i < blob.size - 4) {
      if (i > STEP) break
      const h = parseHeader(b, i)
      if (h) { offsets.push(pos + i); i += h.length } else i++
    }
    pos += i
  }
  return Float64Array.from(offsets)
}

export async function buildIndex(blob) {
  const head = await bytes(blob, 0, 64 * 1024)
  let skip = id3Size(head)
  const b = skip + 16384 > head.length ? await bytes(blob, skip, skip + 16384) : head.subarray(skip)
  const first = findSync(b)
  if (first < 0) return null                                    // not an MP3 → caller falls back to time-based playback
  const h = parseHeader(b, first)
  let dataStart = skip + first
  const tag = tagAt(b, first, h)
  if (tag) dataStart += h.length                                // Xing/Info/VBRI frame carries no audio
  const frameDur = h.samples / h.sampleRate

  if (tag === 'Xing' || tag === 'VBRI') {
    const offsets = await scanFrames(blob, dataStart)
    return {
      kind: 'vbr', frameDur, duration: offsets.length * frameDur, size: blob.size,
      locate(t) {
        const k = Math.max(0, Math.min(offsets.length, Math.round(t / frameDur)))
        return { byte: k < offsets.length ? offsets[k] : blob.size, time: k * frameDur }
      },
    }
  }

  const avg = ((h.mpeg1 ? 144 : 72) * h.bitrate) / h.sampleRate
  const frames = Math.floor((blob.size - dataStart) / avg)
  return {
    kind: 'cbr', frameDur, duration: frames * frameDur, size: blob.size, bitrate: h.bitrate,
    // estimate the frame index, then snap to the real frame start (frames are avg±1 byte because of padding)
    async locate(t) {
      const k = Math.max(0, Math.min(frames, Math.round(t / frameDur)))
      if (k >= frames) return { byte: blob.size, time: frames * frameDur }
      const est = Math.round(dataStart + k * avg)
      const lo = Math.max(dataStart, est - 1024)
      const w = await bytes(blob, lo, Math.min(blob.size, est + 2048))
      let best = -1
      for (let i = findSync(w, 0); i >= 0 && i < w.length; i = findSync(w, i + 1)) {
        if (best < 0 || Math.abs(lo + i - est) < Math.abs(lo + best - est)) best = i
        if (lo + i > est) break
      }
      const byte = best < 0 ? est : lo + best
      return { byte, time: Math.round((byte - dataStart) / avg) * frameDur }
    },
  }
}

// quick duration estimate from the first frame only (for the surah list)
export async function estimateDuration(blob) {
  const head = await bytes(blob, 0, 64 * 1024)
  const skip = id3Size(head)
  const b = skip + 8192 > head.length ? await bytes(blob, skip, skip + 8192) : head.subarray(skip)
  const i = findSync(b)
  if (i < 0) return null
  const h = parseHeader(b, i)
  return tagAt(b, i, h) === 'Xing' ? null : ((blob.size - skip) * 8) / h.bitrate
}
