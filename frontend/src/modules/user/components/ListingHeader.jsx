import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'
import { Breadcrumbs } from './Breadcrumbs'

/** Title block above a product listing: breadcrumbs, title, sub-department links. */
export function ListingHeader({ crumbs, title, description, eyebrow, children, subLinks, compact = false }) {
  return (
    <header className={cn('border-b border-slate-200', compact ? 'pb-2.5' : 'pb-3.5 sm:pb-4')}>
      {crumbs && <Breadcrumbs items={crumbs} />}
      {eyebrow ? (
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-display text-xs font-semibold tracking-wider text-slate-500 uppercase">{eyebrow}</span>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        </div>
      ) : (
        <h1 className={cn('font-display font-bold text-slate-900', compact ? 'mt-1 text-2xl sm:text-3xl' : 'mt-1.5 text-2xl sm:text-3xl lg:text-4xl')}>
          {title}
        </h1>
      )}
      {description && <p className="mt-1 max-w-3xl text-xs sm:text-sm text-slate-600">{description}</p>}
      {children}
      {subLinks?.length > 0 && (
        <nav aria-label="Sub-departments" className="mt-3 flex flex-wrap gap-1.5">
          {subLinks.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-800 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              {s.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
