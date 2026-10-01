import { Link } from 'react-router'
import { useModule } from '@/core/module'
import { useBranding } from '@/core/settings/usePublicSettings'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'

// Each module's logo is designed for its main surface: the white storefront header, or the dark panel sidebar.
const DARK_SURFACE = { user: false, vendor: true, admin: true }

/**
 * The current module's logo (set in Admin → Settings → Branding), or the name with the default mark.
 * `inverted` marks a dark background. On the opposite surface (e.g. the storefront's dark footer) an
 * uploaded logo sits on a plate of its own background colour, so it always looks like the admin preview.
 */
export function Logo({ to = '/', className, inverted = false, suffix }) {
  const module = useModule()
  const { siteName, modules } = useBranding()
  const logo = modules?.[module]?.logo
  const darkLogo = DARK_SURFACE[module] ?? false
  const plate = inverted !== darkLogo
  return (
    <Link to={to} className={cn('flex shrink-0 items-center gap-2', className)} aria-label={`${siteName} home`}>
      {logo?.url ? (
        <span className={cn(plate && 'rounded-md px-2.5 py-1.5', plate && (darkLogo ? 'bg-secondary' : 'bg-white'))}>
          <img src={logo.url} alt={siteName} className="block h-8 w-auto max-w-40 object-contain" />
        </span>
      ) : (
        <>
          <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-fg">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 9h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z" />
              <path d="M9 9V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V9M4 12h16M11 12v3h2v-3" />
            </svg>
          </span>
          <span className={cn('text-lg font-extrabold tracking-tight', inverted ? 'text-white' : 'text-slate-900')}>{siteName}</span>
        </>
      )}
      {suffix && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
            inverted ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600',
          )}
        >
          {suffix}
        </span>
      )}
    </Link>
  )
}

/** Price with MRP strike-through and discount. All values in paise. */
export function Price({ price, mrp, size = 'md', className, showTaxNote = false }) {
  const discount = mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl', xl: 'text-3xl' }
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span className={cn('tabular font-bold text-slate-900', sizes[size])}>{formatINR(price)}</span>
      {discount > 0 && (
        <>
          <span className={cn('tabular text-slate-400 line-through', size === 'sm' ? 'text-xs' : 'text-sm')}>{formatINR(mrp)}</span>
          <span className={cn('font-semibold text-accent-ink', size === 'sm' ? 'text-xs' : 'text-sm')}>{discount}% off</span>
        </>
      )}
      {showTaxNote && <span className="basis-full text-xs text-slate-500">Inclusive of all taxes</span>}
    </div>
  )
}

/** Image with graceful fallback for missing product/category images. */
export function Thumb({ src, alt = '', className, fit = 'contain' }) {
  return src ? (
    <img src={src} alt={alt} loading="lazy" decoding="async" className={cn('bg-white', fit === 'cover' ? 'object-cover' : 'object-contain', className)} />
  ) : (
    <div className={cn('grid place-items-center bg-slate-100 text-slate-300', className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-1/3 max-h-10 max-w-10" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="m21 16-5-5-9 9" />
      </svg>
    </div>
  )
}
