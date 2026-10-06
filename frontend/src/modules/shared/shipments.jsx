import { Check, Download } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { SHIPMENT_STATUS_LABELS } from '@/core/lib/constants'
import { formatDateTime } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { DescriptionList } from '@/ui/PageHeader'

export function ShipmentStatusBadge({ status }) {
  return <StatusBadge status={status} labels={SHIPMENT_STATUS_LABELS} />
}

/** Courier / AWB / ETA facts shared by the admin and vendor views. */
export function ShipmentFacts({ shipment: s, extra = [] }) {
  return (
    <DescriptionList
      className="sm:grid-cols-2"
      items={[
        ['Courier', s.courier ? [s.courier.name, s.courier.service].filter(Boolean).join(' · ') : null],
        ['AWB', s.awbNumber && <span className="font-mono">{s.awbNumber}</span>],
        s.lrNumber && ['LR number', <span className="font-mono">{s.lrNumber}</span>],
        ['Courier status', s.tracking?.currentStatus],
        s.tracking?.expectedDeliveryDate && ['Expected delivery', s.tracking.expectedDeliveryDate],
        s.pickupScheduledAt && ['Pickup scheduled', formatDateTime(s.pickupScheduledAt)],
        s.deliveredAt && ['Delivered', formatDateTime(s.deliveredAt)],
        ...extra,
      ]}
    />
  )
}

/** Downloads a shipping label (fetched through our API; the browser never talks to Shipmozo). */
export function LabelButton({ shipment, fetchLabel }) {
  const [busy, setBusy] = useState(false)
  if (!shipment.awbNumber || shipment.status === 'cancelled') return null
  const download = async () => {
    setBusy(true)
    try {
      const blob = await fetchLabel(shipment._id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `label-${shipment.awbNumber}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" variant="outline" loading={busy} onClick={download}>
      <Download /> Shipping label
    </Button>
  )
}

/** Customer-facing progress: Shipment created → … → Delivered. */
export function ShipmentTimeline({ steps }) {
  if (!steps?.length) return null
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-3">
          <span
            className={cn(
              'grid size-6 shrink-0 place-items-center rounded-full ring-1',
              step.done ? 'bg-primary text-white ring-primary' : 'bg-white text-slate-300 ring-slate-200',
            )}
          >
            <Check className="size-3.5" />
          </span>
          <span className={cn('text-sm', step.current ? 'font-medium text-slate-900' : step.done ? 'text-slate-700' : 'text-slate-400')}>{step.label}</span>
        </li>
      ))}
    </ol>
  )
}

/** Latest courier scans, newest first as the courier reports them. */
export function ScanList({ scans }) {
  if (!scans?.length) return null
  return (
    <ul className="flex flex-col gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
      {scans.slice(0, 8).map((scan, i) => (
        <li key={`${scan.at}-${i}`}>
          <span className="font-medium text-slate-800">{scan.status}</span>
          {scan.location && ` · ${scan.location}`}
          {scan.at && <span className="block text-slate-500">{scan.at}</span>}
        </li>
      ))}
    </ul>
  )
}
