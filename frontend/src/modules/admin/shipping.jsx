import { useQuery } from '@tanstack/react-query'
import { PackagePlus, RefreshCw, RotateCcw, Truck, Wand2, X } from 'lucide-react'
import { useState } from 'react'
import { formatDateTime, formatINR } from '@/core/lib/format'
import { LabelButton, ScanList, ShipmentFacts, ShipmentStatusBadge } from '@/modules/shared/shipments'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { adminApi, adminKeys } from './api'

const PRE_PICKUP = ['pending', 'created', 'courier_assigned', 'pickup_scheduled', 'pickup_pending']
const TRACKABLE = ['courier_assigned', 'pickup_scheduled', 'pickup_pending', 'picked_up', 'in_transit', 'out_for_delivery', 'exception', 'return_in_transit']

/**
 * Shipping controls for one seller's lines on an order.
 * `run(fn, message)` performs a mutation and refreshes the order + shipments.
 */
export function VendorShipments({ shipments, canCreate, onCreate, run }) {
  const [creating, setCreating] = useState(false)
  if (!shipments.length) {
    if (!canCreate) return null
    return (
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
        <p className="text-sm text-slate-600">Not booked with Shipmozo yet.</p>
        <Button
          size="sm"
          loading={creating}
          onClick={async () => {
            setCreating(true)
            await onCreate().finally(() => setCreating(false))
          }}
        >
          <PackagePlus /> Create shipment
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col divide-y divide-slate-100 border-t border-slate-100">
      {shipments.map((s) => (
        <ShipmentRow key={s._id} shipment={s} run={run} />
      ))}
      {canCreate && !shipments.some((s) => s.active && s.type === 'forward') && (
        <div className="flex justify-end px-5 py-3">
          <Button size="sm" variant="outline" onClick={onCreate}>
            <PackagePlus /> Create new shipment
          </Button>
        </div>
      )}
    </div>
  )
}

function ShipmentRow({ shipment: s, run }) {
  const [busy, setBusy] = useState(null)
  // Buttons: one action at a time; errors are already toasted by `run`.
  const act = (fn, message) => async () => {
    setBusy(message)
    try {
      await run(fn, message)
    } catch {
      /* toast shown by run */
    } finally {
      setBusy(null)
    }
  }
  const isReturn = s.type === 'return'
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Truck className="size-4 text-slate-500" />
        <p className="text-sm font-medium text-slate-900">
          {isReturn ? 'Return' : 'Shipment'} <span className="font-mono text-xs text-slate-500">{s.providerOrderId}</span>
        </p>
        <ShipmentStatusBadge status={s.status} />
        {s.paymentType === 'cod' && !isReturn && <span className="text-xs text-slate-500">COD {formatINR(s.codAmount ?? 0)}</span>}
      </div>

      {s.lastError && (
        <Alert tone={s.status === 'pending' ? 'danger' : 'warning'} title={`Last ${s.lastError.operation.replaceAll('_', ' ')} failed`}>
          {s.lastError.message} · {formatDateTime(s.lastError.at)}
          {s.needsVerification && ' — the provider may have received it; it will be verified before retrying.'}
        </Alert>
      )}
      {s.returnInfo && (
        <p className="text-sm text-slate-600">
          {s.returnInfo.reasonTitle} · {s.returnInfo.customerRequest}
          {s.returnInfo.comment && ` · ${s.returnInfo.comment}`}
        </p>
      )}

      {s.status !== 'pending' && (
        <ShipmentFacts
          shipment={s}
          extra={[
            ['Warehouse', s.warehouseId],
            s.package && ['Package', `${s.package.weightGrams} g · ${s.package.lengthCm}×${s.package.widthCm}×${s.package.heightCm} cm`],
            s.tracking?.lastSyncedAt && ['Tracking synced', formatDateTime(s.tracking.lastSyncedAt)],
          ]}
        />
      )}
      <ScanList scans={s.tracking?.scans} />

      {s.status === 'created' && s.rateQuotes.length > 0 && <RateQuotes shipment={s} act={act} busy={busy} />}

      <div className="flex flex-wrap gap-2">
        {s.status === 'pending' && s.active && (
          <Button size="sm" loading={busy === 'Shipment booked'} disabled={Boolean(busy)} onClick={act(() => adminApi.pushShipment(s._id), 'Shipment booked')}>
            <PackagePlus /> {s.failedAttempts ? 'Retry booking' : 'Book shipment'}
          </Button>
        )}
        {s.status === 'created' && (
          <>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'Courier rates updated'}
              disabled={Boolean(busy)}
              onClick={act(() => adminApi.shipmentRates(s._id), 'Courier rates updated')}
            >
              <RefreshCw /> {s.rateQuotes.length ? 'Refresh rates' : 'Get courier rates'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'Courier auto-assigned'}
              disabled={Boolean(busy)}
              onClick={act(() => adminApi.assignCourier(s._id, { auto: true }), 'Courier auto-assigned')}
            >
              <Wand2 /> Auto-assign
            </Button>
          </>
        )}
        {s.status === 'courier_assigned' && s.pickupsAutomaticallyScheduled !== true && (
          <Button
            size="sm"
            loading={busy === 'Pickup scheduled'}
            disabled={Boolean(busy)}
            onClick={act(() => adminApi.schedulePickup(s._id), 'Pickup scheduled')}
          >
            <Truck /> Schedule pickup
          </Button>
        )}
        {!s.awbNumber && ['courier_assigned', 'pickup_scheduled', 'pickup_pending'].includes(s.status) && <AwbDialog shipment={s} run={run} />}
        {s.awbNumber && TRACKABLE.includes(s.status) && (
          <Button
            size="sm"
            variant="outline"
            loading={busy === 'Tracking refreshed'}
            disabled={Boolean(busy)}
            onClick={act(() => adminApi.refreshTracking(s._id), 'Tracking refreshed')}
          >
            <RefreshCw /> Refresh tracking
          </Button>
        )}
        <LabelButton shipment={s} fetchLabel={adminApi.shipmentLabel} />
        {!isReturn && s.status === 'delivered' && <ReturnDialog shipment={s} run={run} />}
        {PRE_PICKUP.includes(s.status) && s.active && (
          <ReasonDialog
            title="Cancel this shipment?"
            description={
              s.awbNumber
                ? 'Shipmozo is asked to cancel it first; nothing changes here unless it confirms.'
                : 'No courier is assigned yet, so it is cancelled here only. Remove any draft from the Shipmozo panel.'
            }
            required={false}
            confirmLabel="Cancel shipment"
            onSubmit={(reason) => run(() => adminApi.cancelShipment(s._id, reason || undefined), 'Shipment cancelled')}
            trigger={
              <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50">
                <X /> Cancel shipment
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}

function RateQuotes({ shipment, act, busy }) {
  return (
    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
      {shipment.rateQuotes.map((q) => (
        <li key={q.courierId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
          <div>
            <p className="font-medium text-slate-900">
              {q.name}
              {q.service && <span className="font-normal text-slate-500"> · {q.service}</span>}
            </p>
            <p className="text-xs text-slate-500">
              {[q.estimatedDelivery, q.pickupsAutomaticallyScheduled === true && 'Pickup auto-scheduled'].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {q.charge !== null && <span className="font-medium">{formatINR(q.charge)}</span>}
            <Button
              size="sm"
              loading={busy === `Assigned ${q.name}`}
              disabled={Boolean(busy)}
              onClick={act(() => adminApi.assignCourier(shipment._id, { courierId: q.courierId }), `Assigned ${q.name}`)}
            >
              Assign
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AwbDialog({ shipment, run }) {
  const [open, setOpen] = useState(false)
  const [awb, setAwb] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await run(() => adminApi.setShipmentAwb(shipment._id, awb.trim()), 'AWB saved')
      setOpen(false)
    } catch {
      /* toast shown by run */
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Enter AWB from the Shipmozo panel"
      description="Use this when the courier assigned an AWB that the API didn't return (e.g. auto-scheduled pickups)."
      trigger={
        <Button size="sm" variant="outline">
          Enter AWB
        </Button>
      }
      footer={
        <Button loading={busy} disabled={awb.trim().length < 4} onClick={submit}>
          Save AWB
        </Button>
      }
    >
      <Field label="AWB number">{(p) => <Input {...p} value={awb} onChange={(e) => setAwb(e.target.value)} />}</Field>
    </Dialog>
  )
}

function ReturnDialog({ shipment, run }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ returnReasonId: '', customerRequest: 'REFUND', comment: '' })
  const [busy, setBusy] = useState(false)
  const { data: reasons = [] } = useQuery({ queryKey: adminKeys.returnReasons, queryFn: adminApi.returnReasons, enabled: open, staleTime: 60 * 60_000 })
  const submit = async () => {
    setBusy(true)
    try {
      await run(
        () =>
          adminApi.createReturn(shipment._id, {
            returnReasonId: Number(form.returnReasonId),
            customerRequest: form.customerRequest,
            comment: form.comment.trim() || undefined,
          }),
        'Return pickup booked',
      )
      setOpen(false)
    } catch {
      /* toast shown by run */
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Book a return pickup"
      description="The courier collects the items from the customer and returns them to the seller. Refunds are not issued automatically."
      trigger={
        <Button size="sm" variant="outline">
          <RotateCcw /> Book return
        </Button>
      }
      footer={
        <Button loading={busy} disabled={!form.returnReasonId} onClick={submit}>
          Book return
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Reason" required>
          {(p) => (
            <Select {...p} value={form.returnReasonId} onChange={(e) => setForm({ ...form, returnReasonId: e.target.value })} placeholder="Choose a reason">
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Customer wants">
          {(p) => (
            <Select {...p} value={form.customerRequest} onChange={(e) => setForm({ ...form, customerRequest: e.target.value })}>
              <option value="REFUND">Refund</option>
              <option value="EXCHANGE">Exchange</option>
            </Select>
          )}
        </Field>
        <Field label="Comment">
          {(p) => <Textarea {...p} rows={3} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />}
        </Field>
      </div>
    </Dialog>
  )
}
