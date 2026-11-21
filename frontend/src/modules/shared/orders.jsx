import { Check, PackageCheck, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/core/lib/cn'
import { formatINR, formatNumber, formatPhone } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { SegmentedControl } from '@/ui/Controls'
import { Checkbox, Field, Input } from '@/ui/Field'
import { ReasonDialog } from '@/ui/ReasonDialog'

/** Mirrors ITEM_TRANSITIONS on the API. */
const NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'shipped', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
}
/** Self pickup: no courier leg, the buyer collects it. */
const NEXT_PICKUP = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'delivered', 'cancelled'],
  packed: ['delivered', 'cancelled'],
}

const ACTION = {
  confirmed: { label: 'Confirm', icon: Check },
  packed: { label: 'Mark packed', icon: PackageCheck },
  shipped: { label: 'Ship', icon: Truck },
  delivered: { label: 'Mark delivered', icon: Check },
}

/** Fulfilment buttons for one order line. `onUpdate(body)` must return a promise. `pickup`: the buyer collects it. */
export function ItemStatusActions({ item, onUpdate, disabled, pickup = false }) {
  const [busy, setBusy] = useState(null)
  const next = (pickup ? NEXT_PICKUP : NEXT)[item.status] ?? []
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
          const { label, icon: Icon } = pickup && s === 'delivered' ? { label: 'Mark collected', icon: Check } : ACTION[s]
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

const EMPTY_TRACKING = { carrier: '', trackingNumber: '', url: '' }
const trimTracking = (t) => {
  const out = Object.fromEntries(
    Object.entries(t)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v),
  )
  return Object.keys(out).length ? out : undefined
}
const fromItem = (item) => ({ ...EMPTY_TRACKING, ...Object.fromEntries(Object.entries(item.tracking ?? {}).filter(([k]) => k in EMPTY_TRACKING)) })

/** Lines that can be shipped now, or whose tracking can still be corrected. Collected-in-person lines never ship. */
export const shippableItems = (items, isPickup = () => false) => items.filter((i) => ['confirmed', 'packed', 'shipped'].includes(i.status) && !isPickup(i))

/**
 * Ships several lines in one go: one tracking number for all of them, or a separate one for each.
 * Lines already shipped can be picked to correct their tracking. `onSubmit(entries)` gets
 * `[{ itemId, tracking }]` and must return a promise.
 */
export function ShipItemsDialog({ items, onSubmit, trigger }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState([])
  const [mode, setMode] = useState('same')
  const [same, setSame] = useState(EMPTY_TRACKING)
  const [each, setEach] = useState({})
  const [error, setError] = useState('')

  const reset = () => {
    // Everything not yet shipped is picked to start with.
    setPicked(items.filter((i) => i.status !== 'shipped').map((i) => i._id))
    setMode('same')
    setSame(EMPTY_TRACKING)
    setEach(Object.fromEntries(items.map((i) => [i._id, fromItem(i)])))
    setError('')
  }
  const toggle = (id) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  const setOne = (id, key, value) => setEach((m) => ({ ...m, [id]: { ...m[id], [key]: value } }))

  const submit = async () => {
    if (!picked.length) return setError('Pick at least one item')
    const entries = items
      .filter((i) => picked.includes(i._id))
      .map((i) => ({ itemId: i._id, tracking: trimTracking(mode === 'same' ? same : (each[i._id] ?? EMPTY_TRACKING)) }))
    const badUrl = entries.find((e) => e.tracking?.url && !/^https?:\/\//i.test(e.tracking.url))
    if (badUrl) return setError('Tracking links must start with https://')
    setError('')
    setBusy(true)
    try {
      await onSubmit(entries)
      setOpen(false)
    } catch {
      /* the caller shows the error; keep the dialog open */
    } finally {
      setBusy(false)
    }
  }

  const trackingFields = (t, set) => (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Courier">{(p) => <Input {...p} placeholder="e.g. Delhivery" value={t.carrier} onChange={(e) => set('carrier', e.target.value)} />}</Field>
      <Field label="Tracking number">{(p) => <Input {...p} value={t.trackingNumber} onChange={(e) => set('trackingNumber', e.target.value)} />}</Field>
      <Field label="Tracking link">
        {(p) => <Input {...p} type="url" placeholder="https://" value={t.url} onChange={(e) => set('url', e.target.value)} />}
      </Field>
    </div>
  )

  const chosen = items.filter((i) => picked.includes(i._id))
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) reset()
        setOpen(v)
      }}
      size="lg"
      title="Ship items"
      description="Pick the items going out and add tracking so the customer can follow the delivery."
      trigger={trigger}
      footer={
        <>
          {error && <p className="mr-auto self-center text-sm text-red-600">{error}</p>}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit} disabled={!picked.length}>
            <Truck /> {picked.length ? `Ship ${picked.length} ${picked.length === 1 ? 'item' : 'items'}` : 'Ship'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-semibold text-slate-900">Items</legend>
            <button
              type="button"
              className="text-xs font-semibold text-primary hover:underline"
              onClick={() => setPicked(picked.length === items.length ? [] : items.map((i) => i._id))}
            >
              {picked.length === items.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {items.map((i) => (
              <Checkbox
                key={i._id}
                className="px-3 py-2.5"
                checked={picked.includes(i._id)}
                onChange={() => toggle(i._id)}
                label={
                  <>
                    {i.name}
                    {i.variant?.title && <span className="font-normal text-slate-500"> · {i.variant.title}</span>}
                  </>
                }
                description={[
                  `Qty ${formatNumber(i.quantity)}`,
                  i.vendor?.store?.name,
                  i.status === 'shipped' ? `Already shipped${i.tracking?.trackingNumber ? ` (${i.tracking.trackingNumber})` : ''}, update tracking` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))}
          </div>
        </fieldset>

        {chosen.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold text-slate-900">Tracking</p>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              size="sm"
              className="self-start"
              options={[
                { value: 'same', label: 'Same for all items' },
                { value: 'separate', label: 'Separate for each item' },
              ]}
            />
          </div>
        )}

        {mode === 'same' || chosen.length <= 1 ? (
          trackingFields(same, (k, v) => setSame((t) => ({ ...t, [k]: v })))
        ) : (
          <div className="flex flex-col gap-4">
            {chosen.map((i) => (
              <div key={i._id} className="rounded-md border border-slate-200 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-900">
                  {i.name}
                  {i.variant?.title && <span className="font-normal text-slate-500"> · {i.variant.title}</span>}
                </p>
                {trackingFields(each[i._id] ?? EMPTY_TRACKING, (k, v) => setOne(i._id, k, v))}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-500">Tracking is optional. Links must start with https://</p>
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

export function AmountRows({ amounts, coupon }) {
  const rows = [
    ['Subtotal', amounts.subtotal],
    ['Shipping', amounts.shipping],
    amounts.discount ? [coupon?.code ? `Coupon ${coupon.code}` : 'Discount', -amounts.discount] : null,
  ].filter(Boolean)
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
      {amounts.wallet > 0 && (
        <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="flex justify-between">
            <dt className="text-slate-600">Paid from wallet</dt>
            <dd className="tabular font-semibold text-slate-900">{formatINR(amounts.wallet)}</dd>
          </div>
          {amounts.balanceDue != null && (
            <div className="flex justify-between">
              <dt className="text-slate-600">Due on delivery (cash)</dt>
              <dd className="tabular font-semibold text-slate-900">{amounts.balanceDue > 0 ? formatINR(amounts.balanceDue) : 'Nothing'}</dd>
            </div>
          )}
          {amounts.walletRefunded > 0 && (
            <div className="flex justify-between text-emerald-700">
              <dt>Returned to wallet</dt>
              <dd className="tabular">−{formatINR(amounts.walletRefunded)}</dd>
            </div>
          )}
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
