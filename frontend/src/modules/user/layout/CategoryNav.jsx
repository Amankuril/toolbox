import { ChevronDown, ChevronRight, LayoutGrid } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { cn } from '@/core/lib/cn'
import { Thumb } from '@/ui/Brand'
import { useCategoryTree } from '../hooks'

/**
 * Desktop category bar: "All categories" mega menu (root → sub → leaf) plus quick links to roots.
 */
export function CategoryBar() {
  const { data: tree = [] } = useCategoryTree()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(null)
  const location = useLocation()
  const timer = useRef(null)
  const current = tree.find((c) => c._id === active) ?? tree[0]

  // Close on navigation.
  const [lastPath, setLastPath] = useState(location.pathname)
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname)
    setOpen(false)
  }

  useEffect(() => () => clearTimeout(timer.current), [])
  const openSoon = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 120)
  }
  const closeSoon = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 150)
  }

  if (!tree.length) return null

  return (
    <nav aria-label="Categories" className="relative hidden border-t border-slate-100 bg-white lg:block" onMouseLeave={closeSoon}>
      <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 sm:px-6">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={openSoon}
          className={cn(
            'flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold',
            open ? 'border-primary text-primary' : 'border-transparent text-slate-800 hover:text-primary',
          )}
        >
          <LayoutGrid className="size-4" /> All categories <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
        <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">
          {tree.slice(0, 7).map((c) => (
            <Link key={c._id} to={`/c/${c.slug}`} className="flex h-11 shrink-0 items-center px-3 text-sm whitespace-nowrap text-slate-600 hover:text-primary">
              {c.name}
            </Link>
          ))}
        </div>
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-t border-slate-200 bg-white shadow-2xl" onMouseEnter={() => clearTimeout(timer.current)}>
          <div className="mx-auto grid max-w-7xl grid-cols-[260px_1fr] px-4 sm:px-6">
            <ul className="max-h-[70vh] overflow-y-auto border-r border-slate-100 py-3">
              {tree.map((c) => (
                <li key={c._id}>
                  <Link
                    to={`/c/${c.slug}`}
                    onMouseEnter={() => setActive(c._id)}
                    onFocus={() => setActive(c._id)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-l-md px-3 py-2.5 text-sm',
                      current?._id === c._id ? 'bg-primary-soft font-semibold text-primary' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {c.name}
                    {c.children?.length > 0 && <ChevronRight className="size-4 opacity-60" />}
                  </Link>
                </li>
              ))}
            </ul>
            {current && (
              <div className="max-h-[70vh] overflow-y-auto p-6">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-900">{current.name}</h3>
                  <Link to={`/c/${current.slug}`} className="text-sm font-medium text-primary hover:underline">
                    View all
                  </Link>
                </div>
                {current.children?.length ? (
                  <div className="grid grid-cols-3 gap-x-8 gap-y-6 xl:grid-cols-4">
                    {current.children.map((sub) => (
                      <div key={sub._id}>
                        <Link to={`/c/${sub.slug}`} className="text-sm font-semibold text-slate-900 hover:text-primary">
                          {sub.name}
                        </Link>
                        {sub.children?.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {sub.children.map((leaf) => (
                              <li key={leaf._id}>
                                <Link to={`/c/${leaf.slug}`} className="text-sm text-slate-600 hover:text-primary">
                                  {leaf.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Browse all products in {current.name}.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}

/** Accordion tree for the mobile drawer. */
export function CategoryAccordion({ onNavigate }) {
  const { data: tree = [] } = useCategoryTree()
  return (
    <ul className="flex flex-col">
      {tree.map((c) => (
        <AccordionNode key={c._id} node={c} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

function AccordionNode({ node, depth = 0, onNavigate }) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children?.length > 0
  return (
    <li className={cn(depth === 0 && 'border-b border-slate-100')}>
      <div className="flex items-center" style={{ paddingLeft: depth * 16 }}>
        <Link
          to={`/c/${node.slug}`}
          onClick={onNavigate}
          className={cn('flex flex-1 items-center gap-3 px-4 py-3 text-sm', depth === 0 ? 'font-semibold text-slate-900' : 'text-slate-700')}
        >
          {depth === 0 && <Thumb src={node.image?.url} className="size-8 rounded" />}
          {node.name}
        </Link>
        {hasChildren && (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="grid size-11 place-items-center text-slate-400"
          >
            <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && hasChildren && (
        <ul className="pb-2">
          {node.children.map((c) => (
            <AccordionNode key={c._id} node={c} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </li>
  )
}
