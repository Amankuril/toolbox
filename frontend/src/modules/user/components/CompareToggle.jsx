import { Check, ChevronRight, GitCompareArrows } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'
import { COMPARE_MAX, compareHref, useCompare } from '../compare/useCompare'

/** "Compare" checkbox under a product. A sibling of the card link, never inside it. */
export function CompareToggle({ product, className }) {
  const checked = useCompare((s) => s.items.some((i) => i._id === product._id))
  const toggle = useCompare((s) => s.toggle)
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 select-none hover:text-slate-900', className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(product)}
        aria-label={`Compare ${product.name}`}
        className="size-4 rounded border-slate-300 accent-[var(--tb-primary)]"
      />
      {checked ? 'Added to compare' : 'Compare'}
    </label>
  )
}

/** Product-page card, in the same family as the quote and WhatsApp cards. */
export function CompareCard({ product, className }) {
  const items = useCompare((s) => s.items)
  const toggle = useCompare((s) => s.toggle)
  const added = items.some((i) => i._id === product._id)
  const ready = added && items.length >= 2

  return (
    <div
      className={cn(
        'flex w-full items-stretch overflow-hidden rounded-lg border-2 transition-colors',
        added ? 'border-sky-500 bg-sky-50' : 'border-sky-500/40 bg-sky-50 hover:border-sky-500',
        className,
      )}
    >
      <button type="button" onClick={() => toggle(product)} aria-pressed={added} className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-600 text-white">
          {added ? <Check className="size-[18px]" strokeWidth={2.5} /> : <GitCompareArrows className="size-[18px]" strokeWidth={2} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">
            {added ? `Added to compare (${items.length} of ${COMPARE_MAX})` : 'Compare with other products'}
          </span>
          <span className="block text-xs text-slate-700">
            {added
              ? ready
                ? 'Tap here to remove it from the list.'
                : 'Add one more product to see them side by side. Tap here to remove.'
              : 'See prices, specifications and sellers side by side.'}
          </span>
        </span>
        {!ready && <ChevronRight className="size-5 shrink-0 text-sky-600" />}
      </button>
      {ready && (
        <Link
          to={compareHref(items.map((i) => i._id))}
          className="flex shrink-0 items-center gap-1 border-l border-sky-200 px-4 text-sm font-bold text-sky-700 hover:bg-sky-100"
        >
          Compare now <ChevronRight className="size-4" />
        </Link>
      )}
    </div>
  )
}
