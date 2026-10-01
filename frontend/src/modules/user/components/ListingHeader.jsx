import { Link } from 'react-router'
import { Breadcrumbs } from './Breadcrumbs'

/** Title block above a product listing: breadcrumbs, big condensed title, sub-department links. */
export function ListingHeader({ crumbs, title, description, eyebrow, children, subLinks }) {
  return (
    <header className="border-b border-slate-200 pb-6">
      {crumbs && <Breadcrumbs items={crumbs} />}
      {eyebrow && <p className="mt-5 font-display text-sm font-semibold tracking-[0.14em] text-slate-500 uppercase">{eyebrow}</p>}
      <h1 className="mt-2 font-display text-4xl leading-[1.05] font-bold text-slate-900 sm:text-[2.75rem]">{title}</h1>
      {description && <p className="mt-2 max-w-3xl text-slate-600">{description}</p>}
      {children}
      {subLinks?.length > 0 && (
        <nav aria-label="Sub-departments" className="mt-5 flex flex-wrap gap-2">
          {subLinks.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="rounded-full border border-slate-300 px-3.5 py-1.5 text-sm font-medium text-slate-800 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              {s.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
