import { cn } from '@/core/lib/cn'
import { Badge } from '@/ui/Badge'

/** Top categories | Other categories, switched at the top of the page. */
export function LevelTabs({ value, onChange, counts = {}, extra = [] }) {
  const tabs = [
    { value: 'top', label: 'Top categories', hint: 'Main departments' },
    { value: 'sub', label: 'Other categories', hint: 'Every sub-category' },
    ...extra,
  ]
  return (
    <div role="tablist" aria-label="Category level" className="mb-4 inline-flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors',
            value === t.value ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-300' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {t.label}
          {counts[t.value] != null && <Badge tone={value === t.value ? 'info' : 'neutral'}>{counts[t.value]}</Badge>}
        </button>
      ))}
    </div>
  )
}
