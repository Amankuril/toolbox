import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router'
import { Thumb } from '@/ui/Brand'

/** Small round picture before a crumb (the category's or product's own image), when there is one. */
function Icon({ src }) {
  if (!src) return null
  return <Thumb src={src} alt="" fit="cover" className="size-5 shrink-0 rounded-full border border-slate-200 bg-white" />
}

/** @param {{ items: { label: string, to?: string, image?: string | null }[] }} props */
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
              <Link to={item.to} className="flex items-center gap-1.5 hover:text-slate-800">
                <Icon src={item.image} />
                {item.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? 'page' : undefined} className="flex items-center gap-1.5 font-medium text-slate-700">
                <Icon src={item.image} />
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
