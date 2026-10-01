import { useQuery } from '@tanstack/react-query'
import { FolderTree, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useDebounce } from '@/core/hooks/useDebounce'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { storeApi, storeKeys } from '../api'

/** Header search with instant product/category suggestions (keyboard navigable). */
export function SearchBox({ className, autoFocus }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const wrapRef = useRef(null)
  const listId = useId()
  const term = useDebounce(q.trim(), 200)

  const { data } = useQuery({ queryKey: storeKeys.suggest(term), queryFn: () => storeApi.suggest(term), enabled: term.length >= 2, staleTime: 60_000 })
  const options = [
    ...(data?.categories ?? []).map((c) => ({ kind: 'category', key: `c-${c._id}`, label: c.name, to: `/c/${c.slug}` })),
    ...(data?.products ?? []).map((p) => ({ kind: 'product', key: `p-${p._id}`, label: p.name, to: `/p/${p.slug}`, image: p.image?.url, price: p.price })),
  ]
  const showList = open && term.length >= 2 && options.length > 0

  useEffect(() => {
    const close = (e) => !wrapRef.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const go = (to) => {
    setOpen(false)
    setCursor(-1)
    navigate(to)
  }

  const searchAll = () => {
    const value = q.trim()
    if (value) go(`/search?q=${encodeURIComponent(value)}`)
  }

  const submit = (e) => {
    e.preventDefault()
    if (showList && cursor >= 0 && options[cursor]) go(options[cursor].to)
    else searchAll()
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <form onSubmit={submit} role="search">
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => (setQ(e.target.value), setOpen(true), setCursor(-1))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(options.length - 1, c + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(-1, c - 1))
            } else if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search drills, pumps, tillers, spare parts…"
          aria-label="Search products"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className="h-11 w-full rounded-md border border-slate-300 bg-white pr-12 pl-4 text-sm shadow-xs placeholder:text-slate-400 focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute inset-y-1 right-1 grid w-10 place-items-center rounded bg-primary text-primary-fg hover:bg-primary-hover"
        >
          <Search className="size-4" />
        </button>
      </form>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl"
        >
          {options.map((o, i) => (
            <li key={o.key} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(o.to)}
                className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm', i === cursor && 'bg-slate-100')}
              >
                {o.kind === 'category' ? (
                  <span className="grid size-9 place-items-center rounded bg-primary-soft text-primary">
                    <FolderTree className="size-4" />
                  </span>
                ) : (
                  <Thumb src={o.image} className="size-9 shrink-0 rounded border border-slate-100" />
                )}
                <span className="min-w-0 flex-1 truncate text-slate-800">{o.label}</span>
                {o.kind === 'category' ? (
                  <span className="text-xs text-slate-500">Category</span>
                ) : (
                  <span className="tabular text-xs font-semibold text-slate-700">{formatINR(o.price)}</span>
                )}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={searchAll} className="w-full rounded-md px-2.5 py-2 text-left text-sm font-medium text-primary hover:bg-slate-50">
              See all results for “{q.trim()}”
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
