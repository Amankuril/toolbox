import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useMemo, useRef, useState } from 'react'
import { cn } from '@/core/lib/cn'
import { controlClass } from './controlClass'

/**
 * Searchable single select for long option lists (categories).
 * @param {{ options: { value: string, label: string, description?: string, depth?: number, disabled?: boolean, badge?: any }[], value?: string,
 *   onChange: (v: string) => void, placeholder?: string, footer?: any, id?: string }} props
 */
export function Combobox({ options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…', footer, id, invalid, emptyText = 'No matches' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef(null)
  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q)) : options
  }, [options, query])

  const choose = (o) => {
    if (o.disabled) return
    onChange(o.value)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover.Root open={open} onOpenChange={(v) => (setOpen(v), setCursor(0))}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          aria-invalid={invalid || undefined}
          className={cn(controlClass, 'flex h-10 items-center justify-between gap-2 text-left')}
        >
          <span className={cn('truncate', !selected && 'text-slate-400')}>{selected ? (selected.description ?? selected.label) : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="relative border-b border-slate-100">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => (setQuery(e.target.value), setCursor(0))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setCursor((c) => Math.min(filtered.length - 1, c + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setCursor((c) => Math.max(0, c - 1))
                } else if (e.key === 'Enter' && filtered[cursor]) {
                  e.preventDefault()
                  choose(filtered[cursor])
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-10 w-full pr-3 pl-9 text-sm outline-none"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">{emptyText}</li>}
            {filtered.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
                  i === cursor && 'bg-slate-100',
                  o.disabled && 'cursor-not-allowed opacity-50',
                )}
                style={!query && o.depth ? { paddingLeft: `${0.625 + o.depth * 1}rem` } : undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-slate-900">{o.label}</span>
                  {query && o.description && <span className="block truncate text-xs text-slate-500">{o.description}</span>}
                </span>
                {o.badge}
                {o.value === value && <Check className="size-4 shrink-0 text-primary" />}
              </li>
            ))}
          </ul>
          {footer && <div className="border-t border-slate-100 p-1">{footer(() => setOpen(false))}</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
