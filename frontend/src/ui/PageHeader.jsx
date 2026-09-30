import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/core/lib/cn'

export function PageHeader({ title, description, actions, back, className, meta }) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
            <ArrowLeft className="size-4" /> {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'primary', to }) {
  const toneClass = { primary: 'bg-primary-soft text-primary', accent: 'bg-accent-soft text-accent', warning: 'bg-amber-50 text-amber-600', neutral: 'bg-slate-100 text-slate-600' }[tone]
  const body = (
    <div className="flex items-start justify-between gap-3 p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
        {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      </div>
      {Icon && (
        <div className={cn('grid size-10 shrink-0 place-items-center rounded-lg', toneClass)}>
          <Icon className="size-5" />
        </div>
      )}
    </div>
  )
  const cls = 'block rounded-lg border border-slate-200 bg-white shadow-xs'
  return to ? (
    <Link to={to} className={cn(cls, 'transition-shadow hover:shadow-md')}>
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
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{term}</dt>
          <dd className="mt-1 text-sm break-words text-slate-900">{detail ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
