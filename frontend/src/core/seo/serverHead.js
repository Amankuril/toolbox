import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router'

/**
 * Head tags the API rendered for crawlers (backend modules/seo, marked data-ssr).
 * Pages render their own <title> and description, so those go before the first render;
 * the rest (canonical URL, social tags, structured data) describe the first URL only.
 */
export function dropServerHead(selector = '[data-ssr]') {
  document.head.querySelectorAll(selector).forEach((el) => el.remove())
}

/** Drops the remaining server head tags on the first in-app navigation. */
export function useServerHeadHandoff() {
  const { pathname } = useLocation()
  const first = useRef(pathname)
  useEffect(() => {
    if (pathname !== first.current) dropServerHead()
  }, [pathname])
}
