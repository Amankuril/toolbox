import { STATUS_LABELS, STATUS_TONES } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { titleCase } from '@/core/lib/format'

const tones = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  primary: 'bg-primary-soft text-primary ring-primary-muted',
  accent: 'bg-accent-soft text-accent-ink ring-accent/25',
}

export function Badge({ tone = 'neutral', className, children, dot = false }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  )
}

/**
 * Price fact, printed like a shelf sticker: "SAVE 22%", "BULK ₹7,299 at 10+".
 * `tone="accent"` is hi-vis yellow on ink text; `ink` is the reverse.
 */
export function Sticker({ tone = 'accent', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2 py-0.5 font-display text-xs font-extrabold tracking-wide whitespace-nowrap uppercase',
        tone === 'accent' ? 'bg-accent text-accent-fg' : 'bg-slate-900 text-accent',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** `labels` overrides the default wording for a domain (e.g. quote statuses). */
export function StatusBadge({ status, className, labels }) {
  if (!status) return null
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'} dot className={className}>
      {labels?.[status] ?? STATUS_LABELS[status] ?? titleCase(status)}
    </Badge>
  )
}
