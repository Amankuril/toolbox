import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Trash2, Warehouse } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { INDIAN_STATES } from '@/core/lib/constants'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { Switch } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Select } from '@/ui/Field'
import { useSeller } from '../seller'

const blank = { name: '', phone: '', line1: '', line2: '', landmark: '', city: '', state: '', pincode: '', hours: '', mapUrl: '', lat: '', lng: '', active: true }

const toBody = (w) => ({
  ...(w._id ? { _id: w._id } : {}),
  name: w.name.trim(),
  phone: (w.phone ?? '').replace(/^\+91/, '') || undefined,
  line1: w.line1.trim(),
  line2: w.line2?.trim() || undefined,
  landmark: w.landmark?.trim() || undefined,
  city: w.city.trim(),
  state: w.state,
  pincode: w.pincode.trim(),
  hours: w.hours?.trim() || undefined,
  mapUrl: w.mapUrl?.trim() || undefined,
  lat: w.lat === '' || w.lat == null ? undefined : Number(w.lat),
  lng: w.lng === '' || w.lng == null ? undefined : Number(w.lng),
  active: w.active !== false,
})

/**
 * Self pickup: buyers can collect from the business address and any warehouses added here, instead of having
 * the order delivered. Optional; the business address itself is unchanged.
 */
export function PickupSettings({ canEdit = true }) {
  const seller = useSeller()
  const qc = useQueryClient()
  const key = [...seller.keys.all, 'pickup']
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: seller.api.pickup })
  const [editing, setEditing] = useState(null) // { index, value }

  const save = useMutation({
    mutationFn: (next) =>
      seller.api.savePickup({
        enabled: next.enabled,
        includeMainAddress: next.includeMainAddress,
        hours: next.hours?.trim() || undefined,
        warehouses: next.warehouses.map(toBody),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(key, saved)
      setEditing(null)
      toast.success('Pickup settings saved')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (isLoading || !data) return <Skeleton className="h-48" />
  const update = (patch) => save.mutate({ ...data, ...patch })
  const main = data.mainAddress

  return (
    <Card>
      <CardHeader
        title="Self pickup & warehouses"
        description="Let buyers collect orders from your store or warehouses. No delivery fee is charged on picked-up items."
        action={<Warehouse className="size-5 text-slate-400" />}
      />
      <CardBody className="flex flex-col gap-5">
        <Switch
          label="Offer self pickup at checkout"
          description="Buyers choose the nearest location below instead of delivery."
          checked={data.enabled}
          disabled={!canEdit || save.isPending}
          onCheckedChange={(enabled) => update({ enabled })}
        />
        <div className="rounded-md border border-slate-200 p-3">
          <Switch
            label="Business address is a pickup point"
            description={main ? [main.line1, main.city, main.pincode].filter(Boolean).join(', ') : 'No business address yet'}
            checked={data.includeMainAddress}
            disabled={!canEdit || save.isPending}
            onCheckedChange={(includeMainAddress) => update({ includeMainAddress })}
          />
        </div>
        <Field label="Pickup hours" hint="Shown to buyers, e.g. Mon–Sat, 10am–7pm. A warehouse can set its own.">
          {(p) => (
            <Input
              {...p}
              defaultValue={data.hours}
              maxLength={120}
              disabled={!canEdit}
              onBlur={(e) => e.target.value.trim() !== (data.hours ?? '') && update({ hours: e.target.value })}
            />
          )}
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Warehouses &amp; other locations</p>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditing({ index: -1, value: blank })}>
                <Plus /> Add location
              </Button>
            )}
          </div>
          {data.warehouses.length ? (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {data.warehouses.map((w, i) => (
                <li key={w._id} className="flex items-start gap-3 p-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                      {w.name} {w.active === false && <Badge tone="warning">Off</Badge>}
                    </p>
                    <p className="text-slate-600">{[w.line1, w.line2, w.city, w.state, w.pincode].filter(Boolean).join(', ')}</p>
                    {w.hours && <p className="text-xs text-slate-500">{w.hours}</p>}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${w.name}`} onClick={() => setEditing({ index: i, value: { ...blank, ...w } })}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${w.name}`}
                        onClick={() => window.confirm(`Remove ${w.name}?`) && update({ warehouses: data.warehouses.filter((_, k) => k !== i) })}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No extra locations yet.</p>
          )}
        </div>
      </CardBody>

      <WarehouseDialog
        key={editing ? `${editing.index}:${editing.value._id ?? 'new'}` : 'closed'}
        editing={editing}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSave={(value) => {
          const warehouses = [...data.warehouses]
          if (editing.index < 0) warehouses.push(value)
          else warehouses[editing.index] = value
          update({ warehouses })
        }}
      />
    </Card>
  )
}

function WarehouseDialog({ editing, saving, onClose, onSave }) {
  const [w, setW] = useState(editing?.value ?? blank)
  const set = (field) => (e) => setW({ ...w, [field]: e.target.value })
  const valid = w.name.trim() && w.line1.trim() && w.city.trim() && w.state && /^[1-9]\d{5}$/.test(w.pincode)
  return (
    <Dialog
      open={Boolean(editing)}
      onOpenChange={(open) => !open && onClose()}
      title={editing?.index < 0 ? 'Add pickup location' : 'Edit pickup location'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!valid} onClick={() => onSave(w)}>
            Save location
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required hint="What buyers see, e.g. Budhana warehouse">
          {(p) => <Input {...p} value={w.name} onChange={set('name')} maxLength={80} />}
        </Field>
        <Field label="Phone" hint="Empty = your main number">
          {(p) => <Input {...p} value={(w.phone ?? '').replace(/^\+91/, '')} onChange={set('phone')} prefix="+91" inputMode="numeric" maxLength={10} className="pl-11" />}
        </Field>
        <Field label="Address" required className="sm:col-span-2">
          {(p) => <Input {...p} value={w.line1} onChange={set('line1')} maxLength={200} />}
        </Field>
        <Field label="Area / locality">{(p) => <Input {...p} value={w.line2} onChange={set('line2')} maxLength={200} />}</Field>
        <Field label="Landmark">{(p) => <Input {...p} value={w.landmark} onChange={set('landmark')} maxLength={120} />}</Field>
        <Field label="Pincode" required>
          {(p) => <Input {...p} value={w.pincode} inputMode="numeric" maxLength={6} onChange={(e) => setW({ ...w, pincode: e.target.value.replace(/\D/g, '') })} />}
        </Field>
        <Field label="City" required>
          {(p) => <Input {...p} value={w.city} onChange={set('city')} maxLength={80} />}
        </Field>
        <Field label="State" required>
          {(p) => (
            <Select {...p} value={w.state} onChange={set('state')} placeholder="Choose a state">
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Hours">{(p) => <Input {...p} value={w.hours} onChange={set('hours')} maxLength={120} placeholder="Mon–Sat, 10am–7pm" />}</Field>
        <Field label="Google Maps link" className="sm:col-span-2">
          {(p) => <Input {...p} value={w.mapUrl} onChange={set('mapUrl')} maxLength={500} placeholder="https://maps.app.goo.gl/…" />}
        </Field>
        <Field label="Latitude" hint="Optional: sorts by distance when a buyer shares their location">
          {(p) => <Input {...p} value={w.lat ?? ''} onChange={set('lat')} inputMode="decimal" placeholder="29.4" />}
        </Field>
        <Field label="Longitude">{(p) => <Input {...p} value={w.lng ?? ''} onChange={set('lng')} inputMode="decimal" placeholder="77.5" />}</Field>
        <div className="sm:col-span-2">
          <Switch label="Open for pickup" checked={w.active !== false} onCheckedChange={(active) => setW({ ...w, active })} />
        </div>
      </div>
    </Dialog>
  )
}
