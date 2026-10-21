import { ChevronDown, ChevronUp, GitCompareArrows, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { safeStorage } from '@/core/lib/storage'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { ComparePicker } from '../compare/ComparePicker'
import { COMPARE_MAX, compareHref, useCompare } from '../compare/useCompare'

const COLLAPSED_KEY = 'tb:compare-tray-collapsed'

/**
 * Bottom tray with the products picked for comparison.
 * Phones get a floating pill (the product page's add-to-cart bar owns the bottom edge there).
 */
export function CompareTray() {
  const items = useCompare((s) => s.items)
  const remove = useCompare((s) => s.remove)
  const clear = useCompare((s) => s.clear)
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(() => safeStorage.get(COLLAPSED_KEY, false))
  const [picking, setPicking] = useState(false)

  if (!items.length || pathname === '/compare') return null
  const href = compareHref(items.map((i) => i._id))
  const ready = items.length >= 2
  const collapse = (v) => {
    setCollapsed(v)
    safeStorage.set(COLLAPSED_KEY, v)
  }

  return (
    <>
      {/* Phones */}
      <div className="fixed right-4 bottom-20 z-30 sm:hidden">
        {ready ? (
          <Button asChild variant="secondary" className="rounded-full shadow-lg">
            <Link to={href}>
              <GitCompareArrows /> Compare ({items.length})
            </Link>
          </Button>
        ) : (
          <span className="flex items-center gap-2 rounded-full bg-secondary py-2 pr-2 pl-4 text-sm font-semibold text-secondary-fg shadow-lg">
            Add 1 more to compare
            <button type="button" onClick={clear} aria-label="Clear compare list" className="grid size-6 place-items-center rounded-full bg-white/15">
              <X className="size-3.5" />
            </button>
          </span>
        )}
      </div>

      {/* Tablets and up */}
      {collapsed ? (
        <div className="fixed right-6 bottom-6 z-30 hidden sm:block">
          <Button
            variant="secondary"
            className="rounded-full shadow-lg"
            onClick={() => collapse(false)}
            aria-label={`Show compare tray, ${items.length} products`}
          >
            <GitCompareArrows /> Compare ({items.length}) <ChevronUp />
          </Button>
        </div>
      ) : (
        <aside
          aria-label="Compare products"
          className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-slate-300 bg-white shadow-[0_-4px_16px_rgb(0_0_0/0.08)] sm:block"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
            <ul className="flex min-w-0 flex-1 gap-3">
              {Array.from({ length: COMPARE_MAX }, (_, i) => items[i]).map((item, i) =>
                item ? (
                  <li key={item._id} className="relative flex w-1/4 min-w-0 items-center gap-2.5 rounded-md border border-slate-200 p-2">
                    <Thumb src={item.image?.url} alt="" className="size-11 shrink-0 rounded bg-slate-100 mix-blend-multiply" />
                    <Link to={`/p/${item.slug}`} className="line-clamp-2 min-w-0 flex-1 text-xs leading-snug font-medium text-slate-900 hover:underline">
                      {item.name}
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(item._id)}
                      aria-label={`Remove ${item.name} from compare`}
                      className="grid size-6 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ) : (
                  <li key={`slot-${i}`} className="w-1/4">
                    <button
                      type="button"
                      onClick={() => setPicking(true)}
                      className="flex size-full min-h-[3.75rem] items-center justify-center gap-1.5 rounded-md border border-dashed border-slate-300 p-2 text-xs font-semibold text-slate-500 transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
                    >
                      <Plus className="size-4" /> Add a product
                    </button>
                  </li>
                ),
              )}
            </ul>
            <div className="flex shrink-0 flex-col items-stretch gap-1.5">
              <Button asChild={ready} disabled={!ready} variant="primary">
                {ready ? <Link to={href}>Compare {items.length} products</Link> : <span>Add 1 more to compare</span>}
              </Button>
              <div className="flex justify-between gap-3">
                <button type="button" onClick={clear} className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline">
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => collapse(true)}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  Hide <ChevronDown className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
      <ComparePicker open={picking} onOpenChange={setPicking} />
      {/* Room at the end of the page so the tray never covers the footer. */}
      {!collapsed && <div className="hidden h-24 sm:block" aria-hidden />}
    </>
  )
}
