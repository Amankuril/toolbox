import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'

export function PageHeader({ title, description, actions, back, className, meta }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="size-4" /> {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[1.75rem] leading-tight font-extrabold tracking-tight text-slate-900 sm:text-[2rem]">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-[0.9375rem] text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'primary', to }) {
  const toneClass = {
    primary: 'text-primary',
    accent: 'text-amber-700',
    warning: 'text-amber-700',
    neutral: 'text-slate-500',
  }[tone]
  const body = (
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {Icon && <Icon className={cn('size-[18px] shrink-0', toneClass)} strokeWidth={1.8} />}
      </div>
      <p className="price text-[1.75rem] leading-none text-slate-900">{value}</p>
      {hint && <p className="text-xs text-slate-600">{hint}</p>}
    </div>
  )
  const cls = 'block rounded-lg border border-slate-200 bg-white'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-colors hover:border-slate-500')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function DescriptionList({ items, className }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {items.filter(Boolean).map(([term, detail]) => (
        <div key={term} className="min-w-0">
          <dt className="eyebrow">{term}</dt>
          <dd className="mt-1 text-sm break-words text-slate-900">{detail ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
