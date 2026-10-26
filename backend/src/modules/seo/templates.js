/**
 * Fills an SEO template from Admin → SEO: {site}, {name}, {brand}, {price}, {category}, {city}.
 * Missing values drop out, and the spaces or separators around them go too.
 */
export function fillTemplate(template, vars) {
  return String(template ?? '')
    .replace(/\{(\w+)\}/g, (_m, key) => (vars[key] == null ? '' : String(vars[key])))
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '')
    .trim();
}
