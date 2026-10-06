import { ArrowLeft, Check, Copy, IndianRupee, Mail, MapPin, MessageSquareQuote, Package, Phone, Printer, Store, X } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { cn } from '@/core/lib/cn'
import { PAYMENT_METHOD_LABEL } from '@/core/lib/constants'
import { formatDateTime, formatINR, formatNumber, formatPhone, titleCase } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'
import { AmountRows } from './orders'

/* ─────────────── helpers ─────────────── */

const STEPS = [
  { key: 'placed', label: 'Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'packed', label: 'Packed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
]
const RANK = { pending: 0, confirmed: 1, packed: 2, shipped: 3, delivered: 4 }
const ACTOR = { user: 'Customer', vendor: 'Seller', admin: 'Admin', system: 'System' }

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error('Could not copy')
  }
}

const addressText = (a) =>
  [a.name, [a.line1, a.line2, a.landmark].filter(Boolean).join(', '), `${a.city}, ${a.state} ${a.pincode}`, a.phone].filter(Boolean).join('\n')

/** Earliest time any line reached a status (from line histories). */
function firstReached(items, status) {
  const times = items.flatMap((i) => (i.history ?? []).filter((h) => h.status === status).map((h) => new Date(h.at).getTime()))
  return times.length ? new Date(Math.min(...times)) : null
}

/* ─────────────── header ─────────────── */

/** Order title with copyable number, statuses, key meta and page actions. */
export function OrderHeader({ order: o, back, actions }) {
  const units = o.items.reduce((n, i) => n + (i.status === 'cancelled' ? 0 : i.quantity), 0)
  return (
    <header className="mb-6 flex flex-col gap-4">
      <Link to={back.to} className="inline-flex items-center gap-1 self-start text-sm font-semibold text-slate-600 hover:text-slate-900 print:hidden">
        <ArrowLeft className="size-4" /> {back.label}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Order</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-[1.75rem] leading-none font-semibold tracking-tight text-slate-900 sm:text-[2.1rem]">{o.orderNumber}</h1>
            <button
              type="button"
              onClick={() => copy(o.orderNumber, 'Order number')}
              className="grid size-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 print:hidden"
              aria-label="Copy order number"
            >
              <Copy className="size-4" />
            </button>
            <StatusBadge status={o.status} />
            <StatusBadge status={o.payment.status} />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            <span>Placed {formatDateTime(o.createdAt)}</span>
            <span>
              {formatNumber(o.items.length)} {o.items.length === 1 ? 'line' : 'lines'} · {formatNumber(units)} {units === 1 ? 'unit' : 'units'}
            </span>
            <span>{PAYMENT_METHOD_LABEL[o.payment.method] ?? titleCase(o.payment.method)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {actions}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print packing slip
          </Button>
        </div>
      </div>
    </header>
  )
}

/* ─────────────── progress ─────────────── */

/** Placed → Delivered, driven by the least advanced line still active (what the customer is waiting on). */
export function OrderProgress({ order: o, items = o.items }) {
  const active = items.filter((i) => i.status !== 'cancelled')
  if (!active.length) {
    return (
      <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-red-900">
        <X className="size-5 shrink-0" />
        <div>
          <p className="font-bold">Cancelled</p>
          <p className="text-sm">{o.cancelReason || 'Every item on this order was cancelled.'}</p>
        </div>
      </div>
    )
  }
  if (o.status === 'pending_payment') return null
  const current = Math.min(...active.map((i) => RANK[i.status] ?? 0))
  return (
    <Card className="mb-6">
      <ol className="grid grid-cols-5 px-2 py-5 sm:px-6">
        {STEPS.map((s, i) => {
          const done = i <= current
          const at = i === 0 ? o.createdAt : firstReached(items, s.key)
          return (
            <li key={s.key} className="relative flex flex-col items-center gap-2 text-center">
              {i > 0 && <span className={cn('absolute top-4 right-1/2 left-[-50%] z-0 h-0.5', i <= current ? 'bg-primary' : 'bg-slate-200')} aria-hidden />}
              <span
                className={cn(
                  'relative z-10 grid size-8 place-items-center rounded-full border-2 text-xs font-bold',
                  done ? 'border-primary bg-primary text-primary-fg' : 'border-slate-300 bg-white text-slate-400',
                  i === current + 1 && 'border-slate-900 text-slate-900',
                )}
              >
                {done ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('text-xs font-semibold sm:text-sm', done ? 'text-slate-900' : 'text-slate-500')}>{s.label}</span>
              <span className="hidden text-[0.7rem] text-slate-500 sm:block">{done && at ? formatDateTime(at) : ' '}</span>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}

/* ─────────────── facts strip ─────────────── */

export function OrderFacts({ order: o, total, label = 'Order total' }) {
  const a = o.shippingAddress
  const facts = [
    { icon: IndianRupee, label, value: <span className="price text-xl">{formatINR(total ?? o.amounts.total)}</span> },
    {
      icon: Package,
      label: 'Items',
      value: (
        <span className="text-base font-bold">
          {formatNumber(o.items.filter((i) => i.status !== 'cancelled').length)} active
          {o.items.some((i) => i.status === 'cancelled') && (
            <span className="ml-1 text-sm font-medium text-slate-500">· {o.items.filter((i) => i.status === 'cancelled').length} cancelled</span>
          )}
        </span>
      ),
    },
    {
      icon: Store,
      label: 'Payment',
      value: (
        <span className="flex flex-wrap items-center gap-2 text-base font-bold">
          {o.payment.method === 'cod' ? 'Cash on delivery' : o.payment.method === 'partial' ? 'Part payment' : 'Prepaid'}
        </span>
      ),
    },
    { icon: MapPin, label: 'Deliver to', value: <span className="text-base font-bold">{a ? `${a.city}, ${a.pincode}` : '—'}</span> },
  ]
  return (
    <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 lg:grid-cols-4">
      {facts.map(({ icon: Icon, label: l, value }) => (
        <div key={l} className="flex flex-col gap-1.5 bg-white px-5 py-4">
          <span className="flex items-center gap-2">
            <Icon className="size-4 text-slate-500" strokeWidth={1.8} />
            <span className="eyebrow">{l}</span>
          </span>
          <span className="text-slate-900">{value}</span>
        </div>
      ))}
    </div>
  )
}

/* ─────────────── items ─────────────── */

/** One seller's lines with a header (store + contact) and a subtotal footer. */
export function SellerItems({ title, subtitle, contactPhone, items, children, footer, className }) {
  const active = items.filter((i) => i.status !== 'cancelled')
  const subtotal = active.reduce((s, i) => s + i.lineTotal, 0)
  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-accent">
            <Store className="size-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[1.0625rem] font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
          </div>
        </div>
        {contactPhone && (
          <a href={`tel:${contactPhone}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-primary print:hidden">
            <Phone className="size-4" /> {formatPhone(contactPhone)}
          </a>
        )}
      </div>
      <ul className="divide-y divide-slate-100 px-5">{children}</ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-sm">
        <span className="text-slate-600">
          {formatNumber(active.reduce((n, i) => n + i.quantity, 0))} units · GST incl. {formatINR(active.reduce((s, i) => s + i.taxAmount, 0))}
        </span>
        <span className="font-semibold text-slate-900">
          Items subtotal <span className="price ml-2 text-base">{formatINR(subtotal)}</span>
        </span>
      </div>
      {footer}
    </Card>
  )
}

/* ─────────────── side cards ─────────────── */

export function PaymentCard({ order: o, amounts = o.amounts, title = 'Payment', note }) {
  return (
    <Card>
      <CardHeader title={title} action={<StatusBadge status={o.payment.status} />} />
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
          <span className="font-semibold text-slate-900">{PAYMENT_METHOD_LABEL[o.payment.method] ?? titleCase(o.payment.method)}</span>
          {o.payment.paidAt && <span className="text-xs text-slate-600">Paid {formatDateTime(o.payment.paidAt)}</span>}
        </div>
        <AmountRows amounts={amounts} />
        {o.payment.failureReason && o.status === 'pending_payment' && <p className="text-xs text-red-700">Last attempt: {o.payment.failureReason}</p>}
        {note}
      </CardBody>
    </Card>
  )
}

export function CustomerCard({ user, billing }) {
  if (!user) return null
  const initials = (user.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <Card>
      <CardHeader title="Customer" />
      <CardBody className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft font-display text-sm font-bold text-primary">{initials}</span>
          <div className="min-w-0">
            <p className="truncate font-bold text-slate-900">{user.name}</p>
            {billing?.businessName && <p className="truncate text-sm text-slate-600">{billing.businessName}</p>}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          {user.phone && (
            <a href={`tel:${user.phone}`} className="flex items-center gap-2 text-slate-800 hover:text-primary">
              <Phone className="size-4 text-slate-500" /> {formatPhone(user.phone)}
            </a>
          )}
          {user.email && (
            <a href={`mailto:${user.email}`} className="flex items-center gap-2 break-all text-slate-800 hover:text-primary">
              <Mail className="size-4 shrink-0 text-slate-500" /> {user.email}
            </a>
          )}
        </div>
        {billing?.gstin && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
            <span>
              <span className="eyebrow block">GSTIN</span>
              <span className="code text-sm text-slate-900">{billing.gstin}</span>
            </span>
            <Button size="icon-sm" variant="ghost" aria-label="Copy GSTIN" onClick={() => copy(billing.gstin, 'GSTIN')} className="print:hidden">
              <Copy />
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function ShipToCard({ address: a, billing, showGstin = false }) {
  if (!a) return null
  return (
    <Card>
      <CardHeader
        title="Ship to"
        action={
          <Button size="sm" variant="ghost" onClick={() => copy(addressText(a), 'Address')} className="print:hidden">
            <Copy /> Copy
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <address className="text-sm leading-relaxed text-slate-800 not-italic">
          <span className="font-bold text-slate-900">{a.name}</span>
          <br />
          {[a.line1, a.line2].filter(Boolean).join(', ')}
          {a.landmark && (
            <>
              <br />
              <span className="text-slate-600">Near {a.landmark}</span>
            </>
          )}
          <br />
          {a.city}, {a.state} <span className="code">{a.pincode}</span>
        </address>
        <a href={`tel:${a.phone}`} className="flex items-center gap-2 text-sm font-semibold text-slate-800 hover:text-primary">
          <Phone className="size-4 text-slate-500" /> {formatPhone(a.phone)}
        </a>
        {showGstin && billing?.gstin && (
          <p className="text-sm text-slate-600">
            Buyer GSTIN <span className="code text-slate-900">{billing.gstin}</span>
            {billing.businessName && ` · ${billing.businessName}`}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

export function NoteCard({ note }) {
  if (!note) return null
  return (
    <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-950">
      <MessageSquareQuote className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} />
      <div>
        <p className="text-xs font-bold tracking-wide uppercase">Customer note</p>
        <p className="mt-0.5 text-sm whitespace-pre-line">{note}</p>
      </div>
    </div>
  )
}

/** Every status change across the lines, newest first. */
export function ActivityTimeline({ order: o, items = o.items }) {
  const events = items
    .flatMap((i) => (i.history ?? []).map((h) => ({ ...h, item: i.name, variant: i.variant?.title })))
    .concat(o.payment.paidAt ? [{ status: 'paid', at: o.payment.paidAt, by: { kind: 'system' }, item: null }] : [])
    .sort((a, b) => new Date(b.at) - new Date(a.at))
  if (!events.length) return null
  return (
    <Card>
      <CardHeader title="Activity" />
      <CardBody>
        <ol className="flex flex-col">
          {events.map((e, i) => (
            <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
              {i < events.length - 1 && <span className="absolute top-3 bottom-0 left-[5px] w-px bg-slate-200" aria-hidden />}
              <span
                className={cn(
                  'relative mt-1.5 size-[11px] shrink-0 rounded-full ring-2 ring-white',
                  e.status === 'cancelled' ? 'bg-red-500' : e.status === 'delivered' || e.status === 'paid' ? 'bg-primary' : 'bg-slate-400',
                )}
              />
              <div className="min-w-0 text-sm">
                <p className="text-slate-900">
                  <span className="font-semibold">{e.status === 'paid' ? 'Payment received' : titleCase(e.status)}</span>
                  {e.item && (
                    <span className="text-slate-600">
                      {' '}
                      · {e.item}
                      {e.variant ? ` (${e.variant})` : ''}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(e.at)} · {ACTOR[e.by?.kind] ?? 'System'}
                </p>
                {e.note && <p className="mt-1 rounded-sm bg-slate-50 px-2 py-1 text-xs text-slate-700">{e.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}
