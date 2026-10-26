import { X } from 'lucide-react'
import { Button } from './Button'
import { Select } from './Field'
import { controlClass } from './controlClass'
import { cn } from '@/core/lib/cn'

/** "From – To" dates for list filters. Values are YYYY-MM-DD strings; `to` covers that whole day. */
export function DateRangeFilter({ from, to, onChange, label = 'Date' }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-slate-600">
      <span className="hidden sm:inline">{label}</span>
      <input type="date" aria-label={`${label} from`} value={from ?? ''} max={to || undefined} onChange={(e) => onChange({ from: e.target.value, to })} className={cn(controlClass, 'h-10 w-auto')} />
      <span aria-hidden>–</span>
      <input type="date" aria-label={`${label} to`} value={to ?? ''} min={from || undefined} onChange={(e) => onChange({ from, to: e.target.value })} className={cn(controlClass, 'h-10 w-auto')} />
      {(from || to) && (
        <Button variant="ghost" size="icon-sm" aria-label="Clear dates" onClick={() => onChange({ from: '', to: '' })}>
          <X />
        </Button>
      )}
    </div>
  )
}

/** API bounds for a YYYY-MM-DD range: the start of `from` and the end of `to`, local time. */
export function dateBounds({ from, to }) {
  return {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
  }
}

/** Category picker for lists: `options` are flattened tree rows ({ _id, path, depth }). */
export function CategoryFilter({ options, value, onChange }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-auto max-w-64">
      <option value="">All categories</option>
      {options.map((c) => (
        <option key={c._id} value={c._id}>
          {`${' '.repeat(c.depth * 2)}${c.name}`}
        </option>
      ))}
    </Select>
  )
}

export const STOCK_FILTERS = [
  { value: '', label: 'Any stock' },
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
]

export function StockFilter({ value, onChange }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} className="w-auto">
      {STOCK_FILTERS.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </Select>
  )
}
