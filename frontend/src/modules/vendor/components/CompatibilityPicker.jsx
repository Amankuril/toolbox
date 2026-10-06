import { useQuery } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import { useState } from 'react'
import { useDebounce } from '@/core/hooks/useDebounce'
import { PRODUCT_TYPE_LABEL } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { Thumb } from '@/ui/Brand'
import { controlClass } from '@/ui/controlClass'
import { Spinner } from '@/ui/Spinner'
import { useSeller } from '../seller'

/**
 * Links a spare part to the machines/tools it fits. Searches every vendor's catalogue,
 * so a part can fit machines sold by someone else.
 */
export function CompatibilityPicker({ value = [], onChange, excludeId }) {
  const seller = useSeller()
  const [q, setQ] = useState('')
  const term = useDebounce(q.trim(), 300)
  const { data = [], isFetching } = useQuery({
    queryKey: [...seller.keys.all, 'compat-search', term],
    queryFn: () => seller.api.compatibilitySearch(term),
    enabled: term.length >= 2,
    staleTime: 60_000,
  })
  const chosen = new Set(value.map((v) => v._id))
  const results = data.filter((r) => r._id !== excludeId)

  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <ul className="flex flex-col gap-2">
          {value.map((m) => (
            <li key={m._id} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
              <Thumb src={m.image?.url ?? m.images?.[0]?.url} className="size-10 shrink-0 rounded" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{m.name}</span>
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                onClick={() => onChange(value.filter((x) => x._id !== m._id))}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search machines or tools by name, brand or model"
          className={cn(controlClass, 'h-10 pl-9')}
          aria-label="Search compatible machines"
        />
        {isFetching && <Spinner className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400" />}
      </div>

      {term.length >= 2 && !isFetching && (
        <ul className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {results.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No machines or tools found for “{term}”.</li>}
          {results.map((r) => (
            <li key={r._id} className="border-b border-slate-100 last:border-0">
              <button
                type="button"
                disabled={chosen.has(r._id)}
                onClick={() => onChange([...value, r])}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
              >
                <Thumb src={r.image?.url} className="size-9 shrink-0 rounded" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{r.name}</span>
                  <span className="block text-xs text-slate-500">{[PRODUCT_TYPE_LABEL[r.type], r.brand, r.modelNumber].filter(Boolean).join(' · ')}</span>
                </span>
                {!chosen.has(r._id) && <Plus className="size-4 text-slate-400" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
