import { useId } from 'react'
import { cn } from '@/core/lib/cn'
import { controlClass } from './controlClass'

/**
 * Label + control + hint/error, wired for accessibility. The child control receives
 * id / aria-invalid / aria-describedby via render prop.
 */
export function Field({ label, hint, error, required, className, children, labelAction }) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={id} className="text-sm font-medium text-slate-800">
            {label}
            {required && <span className="ml-0.5 text-red-600">*</span>}
          </label>
          {labelAction}
        </div>
      )}
      {children({ id, 'aria-invalid': Boolean(error) || undefined, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, prefix, suffix, ...props }) {
  if (!prefix && !suffix) return <input className={cn(controlClass, 'h-10', className)} {...props} />
  return (
    <div className="relative flex items-center">
      {prefix && <span className="pointer-events-none absolute left-3 text-sm text-slate-500">{prefix}</span>}
      <input className={cn(controlClass, 'h-10', prefix && 'pl-8', suffix && 'pr-12', className)} {...props} />
      {suffix && <span className="pointer-events-none absolute right-3 text-sm text-slate-500">{suffix}</span>}
    </div>
  )
}

export function Textarea({ className, rows = 4, ...props }) {
  return <textarea rows={rows} className={cn(controlClass, 'py-2 leading-relaxed', className)} {...props} />
}

export function Select({ className, children, placeholder, ...props }) {
  return (
    <select
      className={cn(controlClass, 'h-10 appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-8', selectChevron, className)}
      {...props}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {children}
    </select>
  )
}

const selectChevron =
  "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]"

export function Checkbox({ label, description, className, ...props }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm', className)}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-[var(--tb-primary)]" {...props} />
      <span>
        <span className="text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  )
}
