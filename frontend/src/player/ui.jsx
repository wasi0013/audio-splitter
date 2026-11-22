import { useEffect, useRef, useState } from 'react'
import { X } from './icons'

export const fmt = (t) => {
  if (t == null || !isFinite(t)) return '–:––'
  t = Math.max(0, Math.floor(t))
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = String(t % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
export const fmtDur = (t) => {
  if (t == null || !isFinite(t)) return ''
  const r = Math.round(t), m = Math.floor(r / 60), s = r % 60
  return m ? (s ? `${m}m ${s}s` : `${m}m`) : `${s}s`
}

// Button that opens a small panel above it (the player bar sits at the bottom). Closes on outside click / Esc.
export function Popover({ label, icon, text, active, children, className = '', align = 'center' }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); box.current?.querySelector('button')?.focus() } }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key, true) }
  }, [open])
  return (
    <div className={`pl-pop ${className}`} ref={box}>
      <button className={`pl-opt${active ? ' on' : ''}${open ? ' open' : ''}`} aria-label={label} title={label} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        {icon}{text && <span>{text}</span>}
      </button>
      {open && <div className={`pl-panel pl-panel-${align}`} role="menu">{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  )
}

// Chips inside a popover: one option per value, current one highlighted.
export function Choice({ title, value, options, onChange }) {
  return (
    <div className="pl-choice">
      {title && <div className="pl-choice-title">{title}</div>}
      <div className="pl-chips" role="radiogroup" aria-label={title}>
        {options.map(([v, t]) => (
          <button key={String(v)} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{t}</button>
        ))}
      </div>
    </div>
  )
}

export function Dialog({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className={`pl-dialog${wide ? ' wide' : ''}`} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <div className="pl-dialog-head">
        <h2>{title}</h2>
        <button className="pl-iconbtn" aria-label="Close" onClick={onClose}><X /></button>
      </div>
      <div className="pl-dialog-body">{open && children}</div>
    </dialog>
  )
}

export function useToast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  const show = (text, kind = 'info') => {
    clearTimeout(timer.current)
    setToast({ text, kind, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 5000 : 1800)
  }
  const node = toast && <div key={toast.id} className={`pl-toast ${toast.kind}`} role="status">{toast.text}</div>
  return [node, show]
}

// Surah map: one band per unit (width ∝ duration), hover tooltip, click / drag to seek, progress inside the current band.
export function Timeline({ chunks, total, time, ci, range, busy, unitName, starts, onSeek }) {
  const bar = useRef(null)
  const [hover, setHover] = useState(null)   // { x, t, i }
  const [drag, setDrag] = useState(null)     // t while dragging
  const ready = !!total
  const at = (e) => {
    const r = bar.current.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width)
    const t = (x / r.width) * total
    let i = 0
    while (i + 1 < chunks.length && chunks[i + 1].start <= t) i++
    return { x, t, i, w: r.width }
  }
  const shown = drag ?? time
  const cur = chunks[ci]
  const curEnd = cur ? (cur.end ?? total) : null
  const label = (i) => chunks[i]?.label || `${unitName} ${i + 1}`
  return (
    <div className={`pl-timeline-wrap${busy ? ' busy' : ''}`}>
      <div
        ref={bar}
        className={`pl-timeline${ready ? '' : ' unknown'}`}
        role="slider"
        tabIndex={0}
        aria-label="Position in surah"
        aria-valuemin={0}
        aria-valuemax={Math.round(total || 0)}
        aria-valuenow={Math.round(shown || 0)}
        aria-valuetext={cur ? `${label(ci)}, ${fmt(shown - cur.start)} of ${fmt(curEnd - cur.start)}` : fmt(shown)}
        onPointerDown={(e) => { if (!ready) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e).t) }}
        onPointerMove={(e) => { if (!ready) return; const h = at(e); setHover(h); if (drag != null) setDrag(h.t) }}
        onPointerUp={(e) => { if (drag == null) return; const t = at(e).t; setDrag(null); onSeek(t) }}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => { if (drag == null) setHover(null) }}
      >
        {chunks.map((c, i) => {
          const end = c.end ?? total
          const w = total && end ? ((end - c.start) / total) * 100 : 100 / chunks.length
          const inRange = range && i >= range.from && i <= range.to
          const fill = i === ci && end ? Math.min(100, Math.max(0, ((shown - c.start) / (end - c.start)) * 100)) : i < ci ? 100 : 0
          return (
            <div key={i} className={`pl-band${i === 0 ? ' first' : ''}${i === chunks.length - 1 ? ' last' : ''}${i === ci ? ' current' : ''}${inRange ? ' range' : ''}${i < ci ? ' past' : ''}`} style={{ width: `${w}%` }}>
              {i === ci && <div className="pl-band-fill" style={{ width: `${fill}%` }} />}
              {w > 2.6 && chunks.length > 1 && <span>{i + 1}</span>}
            </div>
          )
        })}
        {ready && <div className="pl-head" style={{ left: `${Math.min(100, (shown / total) * 100)}%` }} />}
        {hover && ready && (
          <div className="pl-tip" style={{ left: Math.min(Math.max(hover.x, 90), hover.w - 90) }}>
            <strong>{chunks.length > 1 ? `${unitName} ${hover.i + 1} · ` : ''}{label(hover.i)}</strong>
            {starts?.(chunks[hover.i]) && <span className="pl-tip-ar" lang="ar" dir="rtl">{starts(chunks[hover.i])}</span>}
            <span>{fmt(drag ?? hover.t)}</span>
          </div>
        )}
      </div>
      <div className="pl-times"><span>{fmt(shown)}</span><span>{busy ? 'Loading audio…' : fmt(total)}</span></div>
    </div>
  )
}
