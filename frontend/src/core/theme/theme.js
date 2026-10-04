import { safeStorage } from '@/core/lib/storage'

export const THEME_CACHE_KEY = 'tb:theme'
export const RADIUS_PX = { none: 0, sm: 4, md: 8, lg: 12, xl: 16 }

export const DEFAULT_THEMES = {
  user: { primary: '#15803d', secondary: '#0f291e', accent: '#f59e0b', radius: 'md' },
  vendor: { primary: '#15803d', secondary: '#0d2319', accent: '#f59e0b', radius: 'md' },
  admin: { primary: '#15803d', secondary: '#081a12', accent: '#f59e0b', radius: 'md' },
}

function channel(c) {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const DARK_TEXT = '#0b1220'
const LIGHT_TEXT = '#ffffff'

/** Whichever of near-black / white reads better on `bg`. */
export function readableOn(bg) {
  return contrastRatio(bg, LIGHT_TEXT) >= contrastRatio(bg, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT
}

const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

/** Writes a module theme onto :root so every component (and Radix portals) picks it up. */
export function applyTheme(module, theme) {
  const t = { ...DEFAULT_THEMES[module], ...theme }
  const root = document.documentElement
  root.dataset.module = module
  for (const key of ['primary', 'secondary', 'accent']) {
    const color = isHex(t[key]) ? t[key] : DEFAULT_THEMES[module][key]
    root.style.setProperty(`--tb-${key}`, color)
    root.style.setProperty(`--tb-${key}-fg`, readableOn(color))
  }
  root.style.setProperty('--tb-radius', `${RADIUS_PX[t.radius] ?? RADIUS_PX.md}px`)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.secondary)
}

export function cacheThemes(themes) {
  safeStorage.set(THEME_CACHE_KEY, themes)
}

/** Called before React renders so the first paint already uses the admin's colours. */
export function applyCachedTheme(pathname = window.location.pathname) {
  const module = pathname.startsWith('/admin') ? 'admin' : pathname.startsWith('/vendor') ? 'vendor' : 'user'
  const cached = safeStorage.get(THEME_CACHE_KEY)
  applyTheme(module, cached?.[module])
}
