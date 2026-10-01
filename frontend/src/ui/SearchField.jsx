import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDebounce } from '@/core/hooks/useDebounce'
import { cn } from '@/core/lib/cn'
import { controlClass } from './controlClass'

/** Search box that reports a debounced value. Stays in sync if the value changes externally (URL). */
export function SearchField({ value = '', onChange, placeholder = 'Search', className, delay = 350 }) {
  const [text, setText] = useState(value)
  const [synced, setSynced] = useState(value)
  const debounced = useDebounce(text, delay)

  // External change (back button, cleared filter): adopt it during render rather than in an effect.
  if (value !== synced) {
    setSynced(value)
    setText(value)
  }

  useEffect(() => {
    if (debounced !== value) onChange(debounced)
    // onChange identity isn't stable at call sites; only react to the debounced text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  return (
    <div className={cn('relative w-full sm:max-w-xs', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(controlClass, 'h-10 pr-8 pl-9')}
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => setText('')}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
