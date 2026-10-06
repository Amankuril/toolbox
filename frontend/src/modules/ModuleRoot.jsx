import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { ModuleContext } from '@/core/module'
import { useModuleIsolation } from '@/core/navigation/moduleIsolation'
import { useModuleTheme } from '@/core/settings/usePublicSettings'

const DEFAULT_FAVICON = '/toolboxlogo.jpeg'

function getMimeType(url) {
  if (!url) return 'image/jpeg'
  const clean = url.split('?')[0].toLowerCase()
  if (clean.endsWith('.svg')) return 'image/svg+xml'
  if (clean.endsWith('.png')) return 'image/png'
  if (clean.endsWith('.ico')) return 'image/x-icon'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.gif')) return 'image/gif'
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  return ''
}

export function setFavicon(url, version) {
  const href = url || DEFAULT_FAVICON
  const fullHref = version
    ? `${href}${href.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`
    : href
  const type = getMimeType(href)

  const existing = document.querySelectorAll('link[rel*="icon"]')
  // If exactly one icon link exists with the exact target href, keep it
  if (existing.length === 1 && existing[0].getAttribute('href') === fullHref) {
    return
  }

  // Remove existing links so the browser (especially Chrome) re-evaluates tab icon cleanly
  existing.forEach((el) => el.remove())

  const link = document.createElement('link')
  link.id = 'dynamic-favicon'
  link.rel = 'icon'
  if (type) link.type = type
  link.href = fullHref
  document.head.appendChild(link)

  const shortcut = document.createElement('link')
  shortcut.id = 'dynamic-favicon-shortcut'
  shortcut.rel = 'shortcut icon'
  if (type) shortcut.type = type
  shortcut.href = fullHref
  document.head.appendChild(shortcut)
}

/** Applies the admin-configured theme and browser-tab icon for a module to everything below it. */
export function ModuleRoot({ module }) {
  const settings = useModuleTheme(module)
  // One tab, one panel: Back never jumps between store, seller and admin.
  useModuleIsolation(module)
  const moduleFavicon = settings?.branding?.modules?.[module]?.favicon
  const globalFavicon = settings?.branding?.modules?.user?.favicon || settings?.branding?.favicon
  const activeFavicon = moduleFavicon?.url ? moduleFavicon : (globalFavicon?.url ? globalFavicon : null)

  const faviconUrl = activeFavicon?.url || (typeof activeFavicon === 'string' ? activeFavicon : null)
  const faviconVersion = activeFavicon?.media || activeFavicon?.url || null

  useEffect(() => {
    if (settings) setFavicon(faviconUrl, faviconVersion)
  }, [settings, faviconUrl, faviconVersion])

  return (
    <ModuleContext.Provider value={module}>
      <Outlet />
    </ModuleContext.Provider>
  )
}
