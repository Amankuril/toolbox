import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'

/** @param {{ items: { label: string, to?: string }[] }} props */
export function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="scrollbar-none overflow-x-auto">
      <ol className="flex items-center gap-1 text-sm whitespace-nowrap text-slate-500">
        <li>
          <Link to="/" className="hover:text-slate-800">
            Home
          </Link>
        </li>
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            <ChevronRight className="size-3.5 text-slate-400" />
            {item.to && i < items.length - 1 ? (
              <Link to={item.to} className="hover:text-slate-800">
                {item.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className="font-medium text-slate-700">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function CategoryTiles({ categories }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-6">
      {categories.map((c) => (
        <Link
          key={c._id}
          to={`/c/${c.slug}`}
          className="group flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-center transition-shadow hover:shadow-md"
        >
          <div className="aspect-square w-full overflow-hidden rounded-md bg-slate-50">
            {c.image?.url ? (
              <img src={c.image.url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-105" />
            ) : (
              <div className="grid size-full place-items-center text-2xl font-bold text-primary/60">{c.name[0]}</div>
            )}
          </div>
          <span className="line-clamp-2 text-xs font-semibold text-slate-800 group-hover:text-primary sm:text-sm">{c.name}</span>
        </Link>
      ))}
    </div>
  )
}
