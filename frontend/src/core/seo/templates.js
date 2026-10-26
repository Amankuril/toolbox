import { usePublicSettings } from '@/core/settings/usePublicSettings'

/** Same as the API's seo/templates.js: fills {site}, {name}, {brand}, {price}, {category}, {city}; missing values drop out. */
export function fillTemplate(template, vars) {
  return String(template ?? '')
    .replace(/\{(\w+)\}/g, (_m, key) => (vars[key] == null ? '' : String(vars[key])))
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '')
    .trim()
}

/** Page title from Admin → SEO for a kind of page ('home', 'product', 'category', 'store'), the page's own title first. */
export function useSeoTitle(kind, vars, own) {
  const { data } = usePublicSettings()
  const site = data?.branding?.siteName ?? 'ToolsHubs'
  if (own) return own
  return fillTemplate(data?.seo?.[kind]?.title ?? (kind === 'home' ? '{site}' : '{name} | {site}'), { site, ...vars }) || site
}
