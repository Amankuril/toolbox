import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { INDIAN_STATES } from '@/core/lib/constants'
import { addressFields, phone10, required } from '@/core/lib/validators'
import { Button } from '@/ui/Button'
import { Checkbox, Field, Input, Select } from '@/ui/Field'
import { Dialog } from '@/ui/Dialog'
import { SegmentedControl } from '@/ui/Controls'
import { storeKeys, userApi } from '../api'

const schema = z.object({ label: z.string().max(40), name: required('Full name', 120), phone: phone10, ...addressFields, isDefault: z.boolean() })
const LABELS = ['Home', 'Office', 'Workshop', 'Warehouse']

/** Add or edit a saved address. Calls onSaved(addresses, savedAddressId). */
export function AddressDialog({ open, onOpenChange, address, defaults, onSaved }) {
  const qc = useQueryClient()
  const form = useForm({ resolver: zodResolver(schema) })

  useEffect(() => {
    if (!open) return
    const a = address ?? {}
    form.reset({
      label: a.label ?? 'Home',
      name: a.name ?? defaults?.name ?? '',
      phone: (a.phone ?? defaults?.phone ?? '').replace(/^\+91/, ''),
      line1: a.line1 ?? '',
      line2: a.line2 ?? '',
      landmark: a.landmark ?? '',
      city: a.city ?? '',
      state: a.state ?? '',
      pincode: a.pincode ?? '',
      isDefault: a.isDefault ?? false,
    })
  }, [open, address, defaults, form])

  const save = useMutation({
    mutationFn: (v) => (address ? userApi.updateAddress(address._id, v) : userApi.addAddress(v)),
    onSuccess: (addresses, v) => {
      qc.setQueryData(storeKeys.addresses, addresses)
      const saved = address ? addresses.find((a) => a._id === address._id) : addresses.at(-1)
      toast.success(address ? 'Address updated' : 'Address saved')
      onOpenChange(false)
      onSaved?.(addresses, saved?._id ?? v._id)
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })

  const e = form.formState.errors
  const label = useWatch({ control: form.control, name: 'label' })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={address ? 'Edit address' : 'Add a delivery address'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            Save address
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => ev.preventDefault()} noValidate>
        <div className="sm:col-span-2">
          <SegmentedControl
            size="sm"
            value={LABELS.includes(label) ? label : 'Home'}
            onChange={(v) => form.setValue('label', v)}
            options={LABELS.map((l) => ({ value: l, label: l }))}
          />
        </div>
        <Field label="Full name" required error={e.name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}
        </Field>
        <Field label="Mobile number" required error={e.phone?.message}>
          {(p) => <Input {...p} prefix="+91" inputMode="numeric" maxLength={10} autoComplete="tel-national" className="pl-11" {...form.register('phone')} />}
        </Field>
        <Field label="Address line 1" required error={e.line1?.message} className="sm:col-span-2">
          {(p) => <Input {...p} autoComplete="address-line1" placeholder="House / shop no., building, street" {...form.register('line1')} />}
        </Field>
        <Field label="Address line 2" className="sm:col-span-2">
          {(p) => <Input {...p} autoComplete="address-line2" placeholder="Area, colony, village" {...form.register('line2')} />}
        </Field>
        <Field label="Landmark">{(p) => <Input {...p} {...form.register('landmark')} />}</Field>
        <Field label="Pincode" required error={e.pincode?.message}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={6} autoComplete="postal-code" {...form.register('pincode')} />}
        </Field>
        <Field label="City / district" required error={e.city?.message}>
          {(p) => <Input {...p} autoComplete="address-level2" {...form.register('city')} />}
        </Field>
        <Field label="State" required error={e.state?.message}>
          {(p) => (
            <Select {...p} placeholder="Select state" autoComplete="address-level1" {...form.register('state')}>
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox className="sm:col-span-2" label="Make this my default address" {...form.register('isDefault')} />
      </form>
    </Dialog>
  )
}
