import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { ModuleContext } from '@/core/module'
import { useModuleTheme } from '@/core/settings/usePublicSettings'

const DEFAULT_FAVICON = '/favicon.svg'

function setFavicon(url) {
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  const href = url || DEFAULT_FAVICON
  if (link.getAttribute('href') === href) return
  link.type = href.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'
  link.href = href
}

/** Applies the admin-configured theme and browser-tab icon for a module to everything below it. */
export function ModuleRoot({ module }) {
  const settings = useModuleTheme(module)
  const favicon = settings?.branding?.modules?.[module]?.favicon?.url

  useEffect(() => {
    if (settings) setFavicon(favicon)
  }, [settings, favicon])

  return (
    <ModuleContext.Provider value={module}>
      <Outlet />
    </ModuleContext.Provider>
  )
}
