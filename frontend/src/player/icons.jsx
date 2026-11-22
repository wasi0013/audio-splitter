// Inline SVG icons (24×24, currentColor) so controls look the same on every OS — no emoji/Unicode glyphs.
const S = ({ children, size = 20, fill = false, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>{children}</svg>
)

export const Play = (p) => <S fill {...p}><path d="M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8Z" /></S>
export const Pause = (p) => <S fill {...p}><rect x="6" y="4" width="4.2" height="16" rx="1.2" /><rect x="13.8" y="4" width="4.2" height="16" rx="1.2" /></S>
export const SkipBack = (p) => <S fill {...p}><path d="M18.5 5.3v13.4a.9.9 0 0 1-1.4.75L8 13.2v5.3a1 1 0 0 1-2 0v-13a1 1 0 0 1 2 0v5.3l9.1-6.25a.9.9 0 0 1 1.4.75Z" /></S>
export const SkipFwd = (p) => <S fill {...p}><path d="M5.5 5.3v13.4a.9.9 0 0 0 1.4.75L16 13.2v5.3a1 1 0 0 0 2 0v-13a1 1 0 0 0-2 0v5.3L6.9 4.55a.9.9 0 0 0-1.4.75Z" /></S>
export const PrevUnit = (p) => <S {...p}><path d="M5 5v14" /><path d="m19 6-8 6 8 6" /></S>
export const NextUnit = (p) => <S {...p}><path d="M19 5v14" /><path d="m5 6 8 6-8 6" /></S>
export const Back5 = (p) => (
  <S {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4.5h4.5" /><text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">5</text></S>
)
export const Fwd5 = (p) => (
  <S {...p}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v4.5h-4.5" /><text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui, sans-serif">5</text></S>
)
export const Repeat = (p) => <S {...p}><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></S>
export const Repeat1 = (p) => <S {...p}><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /><path d="M11 10h1v4" /></S>
export const Gauge = (p) => <S {...p}><path d="m12 14 4-4" /><path d="M3.34 19a10 10 0 1 1 17.32 0" /></S>
export const Moon = (p) => <S {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></S>
export const Search = (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></S>
export const Keyboard = (p) => <S {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M9 15.5h6" /></S>
export const Settings = (p) => (
  <S {...p}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></S>
)
export const Folder = (p) => <S {...p}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></S>
export const X = (p) => <S {...p}><path d="M18 6 6 18M6 6l12 12" /></S>
export const List = (p) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>
export const Join = (p) => <S {...p}><path d="M12 3v18" strokeDasharray="2 3" /><path d="M3 12h6" /><path d="m6 9 3 3-3 3" /><path d="M15 12h6" /></S>
export const Bars = ({ playing, ...p }) => (
  <S fill {...p} className={`pl-eq${playing ? ' on' : ''}`}><rect x="4" y="10" width="3.2" height="10" rx="1" /><rect x="10.4" y="5" width="3.2" height="15" rx="1" /><rect x="16.8" y="12" width="3.2" height="8" rx="1" /></S>
)
export const Logo = (p) => (
  <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" {...p}>
    <rect width="32" height="32" rx="9" fill="var(--pl-accent)" />
    <path d="M8 19v-6M12 22V10M16 25V7M20 22V10M24 19v-6" stroke="var(--pl-on-accent)" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
)
