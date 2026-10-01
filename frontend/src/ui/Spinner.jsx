import { cn } from '@/core/lib/cn'

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    />
  )
}

export function FullPageLoader() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-primary">
      <Spinner className="size-8 border-[3px]" />
    </div>
  )
}
