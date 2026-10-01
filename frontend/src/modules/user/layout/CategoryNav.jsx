import { ChevronDown, ChevronRight, Layers, Menu as MenuIcon, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { cn } from '@/core/lib/cn'
import { Thumb } from '@/ui/Brand'
import { useCategoryTree } from '../hooks'

/**
 * Department bar under the header: a mega menu for the whole tree (root → sub → leaf),
 * quick links to departments, and the two buying modes trade customers look for.
 */
export function CategoryBar() {
  const { data: tree = [] } = useCategoryTree()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(null)
  const location = useLocation()
  const timer = useRef(null)
  const current = tree.find((c) => c._id === active) ?? tree[0]

  // Close on navigation.
  const [lastPath, setLastPath] = useState(location.pathname + location.search)
  if (location.pathname + location.search !== lastPath) {
    setLastPath(location.pathname + location.search)
    setOpen(false)
  }

  useEffect(() => () => clearTimeout(timer.current), [])
  const openSoon = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 120)
  }
  const closeSoon = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), 160)
  }

  return (
    <nav aria-label="Departments" className="relative hidden bg-secondary text-secondary-fg lg:block" onMouseLeave={closeSoon}>
      <div className="mx-auto flex h-11 max-w-7xl items-stretch px-4 sm:px-6">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={openSoon}
          className={cn(
            '-ml-3 flex items-center gap-2 px-3 font-display text-[15px] font-semibold tracking-wide uppercase',
            open ? 'bg-white text-slate-900' : 'hover:bg-white/10',
          )}
        >
          <MenuIcon className="size-4" /> All departments <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
        <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto">
          {tree.slice(0, 7).map((c) => (
            <Link
              key={c._id}
              to={`/c/${c.slug}`}
              className="flex shrink-0 items-center px-3 font-display text-[15px] font-medium tracking-wide whitespace-nowrap text-secondary-fg/85 uppercase hover:bg-white/10 hover:text-secondary-fg"
            >
              {c.name}
            </Link>
          ))}
        </div>
        <div className="flex shrink-0 items-stretch border-l border-white/15 pl-2">
          <Link
            to="/search?bulk=true"
            className="flex items-center gap-1.5 px-3 font-display text-[15px] font-semibold tracking-wide text-secondary-fg uppercase hover:bg-white/10"
          >
            <Layers className="size-4" /> Bulk deals
          </Link>
          <Link
            to="/#parts-finder"
            className="flex items-center gap-1.5 px-3 font-display text-[15px] font-semibold tracking-wide text-secondary-fg uppercase hover:bg-white/10"
          >
            <Wrench className="size-4" /> Parts finder
          </Link>
        </div>
      </div>

      {open && tree.length > 0 && (
        <div
          className="absolute inset-x-0 top-full z-40 border-b border-slate-200 bg-white text-slate-900 shadow-2xl"
          onMouseEnter={() => clearTimeout(timer.current)}
        >
          <div className="mx-auto grid max-w-7xl grid-cols-[280px_1fr] px-4 sm:px-6">
            <ul className="max-h-[70vh] overflow-y-auto border-r border-slate-200 py-3">
              {tree.map((c) => (
                <li key={c._id}>
                  <Link
                    to={`/c/${c.slug}`}
                    onMouseEnter={() => setActive(c._id)}
                    onFocus={() => setActive(c._id)}
                    className={cn(
                      'flex items-center justify-between gap-2 py-2.5 pr-3 pl-3 text-[15px]',
                      current?._id === c._id ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {c.name}
                    {c.children?.length > 0 && <ChevronRight className="size-4 text-slate-400" />}
                  </Link>
                </li>
              ))}
            </ul>
            {current && (
              <div className="max-h-[70vh] overflow-y-auto px-8 py-6">
                <div className="mb-6 flex items-baseline justify-between gap-4 border-b border-slate-200 pb-3">
                  <h3 className="font-display text-2xl font-bold">{current.name}</h3>
                  <Link to={`/c/${current.slug}`} className="text-sm font-semibold underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900">
                    Shop all {current.name}
                  </Link>
                </div>
                {current.children?.length ? (
                  <div className="grid grid-cols-3 gap-x-10 gap-y-7 xl:grid-cols-4">
                    {current.children.map((sub) => (
                      <div key={sub._id}>
                        <Link to={`/c/${sub.slug}`} className="text-[15px] font-semibold text-slate-900 hover:underline">
                          {sub.name}
                        </Link>
                        {sub.children?.length > 0 && (
                          <ul className="mt-2 flex flex-col gap-1.5">
                            {sub.children.map((leaf) => (
                              <li key={leaf._id}>
                                <Link to={`/c/${leaf.slug}`} className="text-sm text-slate-600 hover:text-slate-900 hover:underline">
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
                  <p className="text-sm text-slate-500">Browse everything in {current.name}.</p>
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
          className={cn('flex flex-1 items-center gap-3 px-4 py-3', depth === 0 ? 'text-[15px] font-semibold text-slate-900' : 'text-sm text-slate-700')}
        >
          {depth === 0 && <Thumb src={node.image?.url} className="size-8 rounded" fit="cover" />}
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
