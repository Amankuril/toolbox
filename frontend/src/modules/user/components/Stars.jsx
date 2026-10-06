import { Star } from 'lucide-react'
import { cn } from '@/core/lib/cn'
import { formatNumber } from '@/core/lib/format'

/** Five stars filled to `value` (0–5, fractions shown as a partial star). Decorative: pair with text. */
export function Stars({ value = 0, size = 16, className }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100))
  const row = (filled) => (
    <span className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} style={{ width: size, height: size }} className={filled ? 'fill-current' : ''} strokeWidth={filled ? 0 : 1.6} />
      ))}
    </span>
  )
  return (
    <span className={cn('relative inline-flex shrink-0 text-amber-500', className)} aria-hidden>
      <span className="text-slate-300">{row(false)}</span>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        {row(true)}
      </span>
    </span>
  )
}

/** "★★★★½ 4.5 (12)" for cards and headers; renders nothing until there's a review. */
export function RatingInline({ rating, className, size = 13 }) {
  if (!rating?.count) return null
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <Stars value={rating.average} size={size} />
      <span className="font-semibold text-slate-900">{rating.average.toFixed(1)}</span>
      <span className="text-slate-500">({formatNumber(rating.count)})</span>
      <span className="sr-only">
        Rated {rating.average} out of 5 from {rating.count} reviews
      </span>
    </span>
  )
}
