import { cn } from '@/core/lib/cn'

/** Shared look for text inputs, selects and textareas. */
export const controlClass = cn(
  'block w-full rounded-md border border-slate-300 bg-white px-3 text-[0.9375rem] text-slate-900 transition-colors',
  'placeholder:text-slate-500/75 hover:border-slate-500',
  'focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500',
  'aria-invalid:border-red-400 aria-invalid:focus:ring-red-500/15',
)
