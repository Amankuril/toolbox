import { useQuery } from '@tanstack/react-query'
import { CornerDownLeft, FolderTree, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useDebounce } from '@/core/hooks/useDebounce'
import { cn } from '@/core/lib/cn'
import { formatINR } from '@/core/lib/format'
import { Thumb } from '@/ui/Brand'
import { storeApi, storeKeys } from '../api'
import { useCategoryTree } from '../hooks'

/**
 * Header search: optional department scope, instant product/category suggestions,
 * full keyboard support. Model numbers match too, which is how trade buyers search.
 */
export function SearchBox({ className, autoFocus, compact = false }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: tree = [] } = useCategoryTree()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [scope, setScope] = useState(params.get('category') ?? '')
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
    if (!value) return
    const qs = new URLSearchParams({ q: value })
    if (scope) qs.set('category', scope)
    go(`/search?${qs}`)
  }

  const submit = (e) => {
    e.preventDefault()
    if (showList && cursor >= 0 && options[cursor]) go(options[cursor].to)
    else searchAll()
  }

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <form onSubmit={submit} role="search" className="flex h-10 sm:h-10.5 overflow-hidden rounded-md border-2 border-secondary bg-white focus-within:border-primary">
        {!compact && tree.length > 0 && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label="Search in department"
            className="hidden max-w-44 cursor-pointer truncate border-r border-slate-200 bg-slate-100 pr-2 pl-3 text-sm font-medium text-slate-700 outline-none lg:block"
          >
            <option value="">All departments</option>
            {tree.map((c) => (
              <option key={c._id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        )}
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
          placeholder="Search products, brands or model numbers"
          aria-label="Search products"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent px-4 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
        />
        <button type="submit" className="flex shrink-0 items-center gap-2 bg-primary px-4 text-sm font-semibold text-primary-fg hover:bg-primary-hover lg:px-5">
          <Search className="size-[18px]" />
          <span className="hidden lg:inline">Search</span>
        </button>
      </form>

      {showList && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-xl">
          {options.map((o, i) => (
            <li key={o.key} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(o.to)}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm', i === cursor && 'bg-slate-100')}
              >
                {o.kind === 'category' ? (
                  <span className="grid size-9 place-items-center rounded bg-slate-100 text-slate-500">
                    <FolderTree className="size-4" />
                  </span>
                ) : (
                  <Thumb src={o.image} className="size-9 shrink-0 rounded bg-[#f4f4f2]" />
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
          <li className="border-t border-slate-100">
            <button type="button" onClick={searchAll} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-slate-900 hover:bg-slate-50">
              See all results for “{q.trim()}”
              <CornerDownLeft className="size-4 text-slate-400" />
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
