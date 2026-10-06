import { Check, PackageCheck, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber, formatPhone } from '@/core/lib/format'
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
  const cancelled = item.status === 'cancelled'
  return (
    <li className={cn('flex flex-col gap-4 py-5 sm:flex-row sm:items-start', cancelled && 'opacity-70')}>
      <Thumb src={item.image} alt="" className="size-20 shrink-0 rounded-md border border-slate-200 bg-slate-100" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn('font-semibold text-slate-900', cancelled && 'line-through decoration-slate-400')}>{item.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              {item.variant?.title && <span className="rounded-sm bg-slate-900 px-1.5 py-0.5 font-semibold text-white">{item.variant.title}</span>}
              {item.pricing?.source === 'bulk' && (
                <span className="rounded-sm bg-accent px-1.5 py-0.5 font-bold text-accent-fg">Bulk price · {item.pricing.tierMinQty}+</span>
              )}
              {item.pricing?.source === 'quote' && <span className="rounded-sm bg-sky-100 px-1.5 py-0.5 font-semibold text-sky-800">Quoted price</span>}
              {item.refunded && <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">Refunded</span>}
            </div>
            <p className="code mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
              {item.sku && <span>SKU {item.sku}</span>}
              {item.hsnCode && <span>HSN {item.hsnCode}</span>}
              <span>GST {item.gstRate}%</span>
            </p>
            {showVendor && item.vendor?.store?.name && <p className="mt-1 text-xs text-slate-500">Sold by {item.vendor.store.name}</p>}
          </div>
          <div className="flex flex-col items-end gap-1.5 text-right">
            <p className="price text-lg text-slate-900">{formatINR(item.lineTotal)}</p>
            <p className="text-xs text-slate-600">
              {formatNumber(item.quantity)} × {formatINR(item.unitPrice)}
              {item.basePrice > item.unitPrice && <span className="ml-1 text-slate-400 line-through">{formatINR(item.basePrice)}</span>}
            </p>
            <StatusBadge status={item.status} />
          </div>
        </div>
        {item.tracking && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <Truck className="size-4 text-slate-500" />
            <span className="font-semibold">{item.tracking.carrier}</span>
            <span className="code">{item.tracking.trackingNumber}</span>
            {item.tracking.url && (
              <a href={item.tracking.url} target="_blank" rel="noreferrer" className="ml-auto font-semibold text-primary hover:underline">
                Track
              </a>
            )}
          </p>
        )}
        {actions && <div className="mt-3 print:hidden">{actions}</div>}
      </div>
    </li>
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
      {amounts.advance > 0 && (
        <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex justify-between">
            <dt className="text-slate-600">Advance paid online</dt>
            <dd className="tabular font-semibold text-slate-900">{formatINR(amounts.advance)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-600">Due on delivery (cash)</dt>
            <dd className="tabular font-semibold text-slate-900">{amounts.balanceDue > 0 ? formatINR(amounts.balanceDue) : 'Nothing'}</dd>
          </div>
        </div>
      )}
      {amounts.refunded > 0 && (
        <div className="flex justify-between text-emerald-700">
          <dt>Refunded</dt>
          <dd className="tabular">−{formatINR(amounts.refunded)}</dd>
        </div>
      )}
    </dl>
  )
}
