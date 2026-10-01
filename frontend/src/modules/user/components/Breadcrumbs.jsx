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
