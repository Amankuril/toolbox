import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { toast } from 'sonner'

/** Which panel a path belongs to. Everything outside /vendor and /admin is the storefront. */
export function moduleOfPath(pathname = '') {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin'
  if (pathname === '/vendor' || pathname.startsWith('/vendor/')) return 'vendor'
  return 'user'
}

const NAMES = { user: 'store', vendor: 'seller panel', admin: 'admin panel' }

function openInNewTab(href) {
  window.open(href, '_blank', 'noopener')
}

/**
 * Keeps a browser tab inside one panel, so Back/Forward never jumps between the store,
 * seller panel and admin panel:
 *  - links to another panel open in a new tab (whatever component rendered them);
 *  - any other in-app navigation across panels (Back/Forward through old history, or code)
 *    is blocked; the tab stays where it is and offers to open that page in a new tab.
 * Typing a URL in the address bar is a fresh page load and is never interfered with.
 */
export function useModuleIsolation(module) {
  useEffect(() => {
    function onClick(e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || moduleOfPath(url.pathname) === module) return
      // React Router's <Link> skips navigation when the click was already default-prevented.
      e.preventDefault()
      openInNewTab(url.href)
    }
    // Capture phase: runs before React's own click handling.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [module])

  const blocker = useBlocker(({ nextLocation }) => moduleOfPath(nextLocation.pathname) !== module)

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const next = blocker.location
    blocker.reset()
    const href = `${next.pathname}${next.search}${next.hash}`
    toast(`That page is in the ${NAMES[moduleOfPath(next.pathname)]}`, {
      description: `This tab stays in the ${NAMES[module]}.`,
      action: { label: 'Open in new tab', onClick: () => openInNewTab(href) },
    })
  }, [blocker, module])
}
