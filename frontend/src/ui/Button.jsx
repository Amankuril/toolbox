import { Slot } from 'radix-ui'
import { cn } from '@/core/lib/cn'
import { Spinner } from './Spinner'

const variants = {
  primary: 'bg-primary text-primary-fg shadow-sm hover:bg-primary-hover',
  secondary: 'bg-secondary text-secondary-fg shadow-sm hover:bg-secondary-hover',
  accent: 'bg-accent text-accent-fg shadow-sm hover:brightness-95',
  outline: 'border border-slate-300 bg-white text-slate-800 shadow-xs hover:border-slate-400 hover:bg-slate-50',
  soft: 'bg-primary-soft text-primary hover:bg-primary-muted',
  ghost: 'text-slate-700 hover:bg-slate-100',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700',
  'danger-outline': 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
  link: 'h-auto px-0 text-primary underline-offset-4 hover:underline',
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
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors select-none',
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
