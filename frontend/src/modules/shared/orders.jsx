import { Check, PackageCheck, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/core/lib/cn'
import { formatDateTime, formatINR, formatPhone, titleCase } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Field, Input } from '@/ui/Field'
import { ReasonDialog } from '@/ui/ReasonDialog'

/** Mirrors ITEM_TRANSITIONS on the API. */
const NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'shipped', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
}

const ACTION = {
  confirmed: { label: 'Confirm', icon: Check },
  packed: { label: 'Mark packed', icon: PackageCheck },
  shipped: { label: 'Ship', icon: Truck },
  delivered: { label: 'Mark delivered', icon: Check },
}

/** Fulfilment buttons for one order line. `onUpdate(body)` must return a promise. */
export function ItemStatusActions({ item, onUpdate, disabled }) {
  const [busy, setBusy] = useState(null)
  const next = NEXT[item.status] ?? []
  if (!next.length || disabled) return null

  const run = async (status, extra = {}) => {
    setBusy(status)
    try {
      await onUpdate({ status, ...extra })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {next
        .filter((s) => s !== 'cancelled')
        .map((s, i) => {
          const { label, icon: Icon } = ACTION[s]
          if (s === 'shipped') return <ShipDialog key={s} primary={i === 0} onSubmit={(tracking) => run('shipped', { tracking })} />
          return (
            <Button key={s} size="sm" variant={i === 0 ? 'primary' : 'outline'} loading={busy === s} onClick={() => run(s).catch(() => {})}>
              <Icon /> {label}
            </Button>
          )
        })}
      {next.includes('cancelled') && (
        <ReasonDialog
          title="Cancel this item"
          description="Stock is returned automatically. Paid online orders are refunded for this item."
          confirmLabel="Cancel item"
          onSubmit={(note) => run('cancelled', { note })}
          trigger={
            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">
              <X /> Cancel
            </Button>
          }
        />
      )}
    </div>
  )
}

function ShipDialog({ onSubmit, primary }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [t, setT] = useState({ carrier: '', trackingNumber: '', url: '' })
  const submit = async () => {
    setBusy(true)
    try {
      const tracking = Object.fromEntries(Object.entries(t).filter(([, v]) => v.trim()))
      await onSubmit(Object.keys(tracking).length ? tracking : undefined)
      setOpen(false)
    } catch {
      /* error already shown by the caller; keep the dialog open */
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title="Ship item"
      description="Add tracking so the customer can follow the delivery."
      trigger={
        <Button size="sm" variant={primary ? 'primary' : 'outline'}>
          <Truck /> Ship
        </Button>
      }
      footer={
        <>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            Mark shipped
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Courier">
          {(p) => <Input {...p} placeholder="e.g. Delhivery, Blue Dart" value={t.carrier} onChange={(e) => setT({ ...t, carrier: e.target.value })} />}
        </Field>
        <Field label="Tracking number">
          {(p) => <Input {...p} value={t.trackingNumber} onChange={(e) => setT({ ...t, trackingNumber: e.target.value })} />}
        </Field>
        <Field label="Tracking link" hint="Optional, must start with https://">
          {(p) => <Input {...p} type="url" placeholder="https://" value={t.url} onChange={(e) => setT({ ...t, url: e.target.value })} />}
        </Field>
      </div>
    </Dialog>
  )
}

export function OrderItemRow({ item, actions, showVendor = false }) {
  return (
    <li className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start">
      <Thumb src={item.image} alt="" className="size-16 shrink-0 rounded-lg border border-slate-200" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{item.name}</p>
            {item.variant?.title && <p className="text-sm text-slate-600">{item.variant.title}</p>}
            <p className="mt-0.5 text-xs text-slate-500">
              {[item.sku && `SKU ${item.sku}`, `Qty ${item.quantity}`, `${formatINR(item.unitPrice)} each`, `GST ${item.gstRate}%`].filter(Boolean).join(' · ')}
              {item.pricing?.source === 'bulk' && (
                <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent-ink">Bulk price ({item.pricing.tierMinQty}+)</span>
              )}
              {item.pricing?.source === 'quote' && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700">Quoted price</span>}
            </p>
            {showVendor && item.vendor?.store?.name && <p className="mt-0.5 text-xs text-slate-500">Sold by {item.vendor.store.name}</p>}
          </div>
          <div className="text-right">
            <p className="tabular font-semibold text-slate-900">{formatINR(item.lineTotal)}</p>
            <StatusBadge status={item.status} className="mt-1" />
          </div>
        </div>
        {item.tracking && (
          <p className="mt-2 text-sm text-slate-600">
            <Truck className="mr-1 inline size-4 text-slate-400" />
            {item.tracking.carrier} {item.tracking.trackingNumber}
            {item.tracking.url && (
              <a href={item.tracking.url} target="_blank" rel="noreferrer" className="ml-2 font-medium text-primary hover:underline">
                Track
              </a>
            )}
          </p>
        )}
        {item.refunded && <p className="mt-1 text-xs font-medium text-emerald-700">Refunded</p>}
        {actions && <div className="mt-3">{actions}</div>}
        {item.history?.length > 1 && <ItemHistory history={item.history} />}
      </div>
    </li>
  )
}

function ItemHistory({ history }) {
  return (
    <details className="group mt-3">
      <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-800">History</summary>
      <ol className="mt-2 flex flex-col gap-2 border-l border-slate-200 pl-4">
        {history.map((h, i) => (
          <li key={i} className="relative text-xs">
            <span
              className={cn('absolute top-1 -left-[21px] size-2.5 rounded-full ring-2 ring-white', h.status === 'cancelled' ? 'bg-red-400' : 'bg-slate-300')}
            />
            <span className="font-medium text-slate-800">{titleCase(h.status)}</span> <span className="text-slate-500">· {formatDateTime(h.at)}</span>
            {h.note && <p className="text-slate-600">{h.note}</p>}
          </li>
        ))}
      </ol>
    </details>
  )
}

export function AddressBlock({ address }) {
  if (!address) return null
  return (
    <address className="text-sm leading-relaxed text-slate-700 not-italic">
      <span className="font-medium text-slate-900">{address.name}</span>
      <br />
      {[address.line1, address.line2, address.landmark].filter(Boolean).join(', ')}
      <br />
      {address.city}, {address.state} {address.pincode}
      <br />
      {formatPhone(address.phone)}
    </address>
  )
}

export function AmountRows({ amounts }) {
  const rows = [['Subtotal', amounts.subtotal], ['Shipping', amounts.shipping], amounts.discount ? ['Discount', -amounts.discount] : null].filter(Boolean)
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {rows.map(([label, v]) => (
        <div key={label} className="flex justify-between">
          <dt className="text-slate-600">{label}</dt>
          <dd className="tabular text-slate-900">{v === 0 && label === 'Shipping' ? 'Free' : formatINR(v)}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold">
        <dt>Total</dt>
        <dd className="tabular">{formatINR(amounts.total)}</dd>
      </div>
      <p className="text-xs text-slate-500">Includes GST of {formatINR(amounts.tax)}</p>
      {amounts.refunded > 0 && (
        <div className="flex justify-between text-emerald-700">
          <dt>Refunded</dt>
          <dd className="tabular">−{formatINR(amounts.refunded)}</dd>
        </div>
      )}
    </dl>
  )
}
