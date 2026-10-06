import { Slot } from 'radix-ui'
import { cn } from '@/core/lib/cn'
import { Spinner } from './Spinner'

/*
 * accent (hi-vis) is reserved for the moment money changes hands: Buy now, Pay, Place order.
 * strong is the storefront's ink-outlined secondary; outline is the quieter panel version.
 */
const variants = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover active:translate-y-px',
  secondary: 'bg-secondary text-secondary-fg hover:bg-secondary-hover active:translate-y-px',
  accent: 'bg-accent font-bold text-accent-fg hover:brightness-[0.96] active:translate-y-px',
  strong: 'border-[1.5px] border-slate-900 bg-white text-slate-900 hover:bg-slate-900 hover:text-white',
  outline: 'border border-slate-300 bg-white text-slate-900 hover:border-slate-500 hover:bg-slate-50',
  soft: 'bg-primary-soft text-primary hover:bg-primary-muted',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
  'danger-outline': 'border border-red-200 bg-white text-red-700 hover:border-red-400 hover:bg-red-50',
  link: 'h-auto px-0 text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary',
}

const sizes = {
  xs: 'h-7 gap-1 px-2.5 text-xs',
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
  icon: 'size-9',
  'icon-sm': 'size-8',
}

/**
 * @param {{ variant?: keyof variants, size?: keyof sizes, loading?: boolean, asChild?: boolean }} props
 */
export function Button({ variant = 'primary', size = 'md', loading = false, asChild = false, className, children, disabled, ...props }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      type={asChild ? undefined : 'button'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-semibold whitespace-nowrap transition-[background-color,border-color,color,filter,transform] duration-150 select-none',
        'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Spinner className="size-4" />}
          {children}
        </>
      )}
    </Comp>
  )
}
