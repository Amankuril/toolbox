import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, ExternalLink, Truck } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage, parseApiError } from '@/core/api/errors'
import { INDIAN_STATES } from '@/core/lib/constants'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { PageHeader } from '@/ui/PageHeader'
import { useAdminAccess } from '../access'
import { storeSeller } from './seller'

const { api, keys } = storeSeller

function toForm(s) {
  const a = s.address ?? {}
  return {
    storeName: s.store?.name ?? '',
    storeDescription: s.store?.description ?? '',
    logo: s.store?.logo ? [s.store.logo] : [],
    contactName: s.contactName ?? '',
    phone: (s.phone ?? '').replace(/^\+91/, ''),
    whatsapp: (s.store?.whatsapp ?? '').replace(/^\+91/, ''),
    email: s.email ?? '',
    legalName: s.business?.legalName ?? '',
    gstin: s.business?.gstin ?? '',
    line1: a.line1 ?? '',
    line2: a.line2 ?? '',
    landmark: a.landmark ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    pincode: a.pincode ?? '',
  }
}

/** Only sends what's filled in, so a half-finished pickup address doesn't block renaming the store. */
function toBody(f) {
  const t = (v) => v.trim()
  const body = {
    storeName: t(f.storeName),
    storeDescription: t(f.storeDescription) || undefined,
    logo: f.logo[0] ? { media: f.logo[0].media } : null,
    contactName: t(f.contactName) || undefined,
    legalName: t(f.legalName) || undefined,
    gstin: t(f.gstin).toUpperCase(),
  }
  if (t(f.phone)) body.phone = t(f.phone)
  // Empty clears it: chats then go to the pickup phone.
  body.whatsapp = t(f.whatsapp)
  if (t(f.email)) body.email = t(f.email)
  if ([f.line1, f.city, f.state, f.pincode].every((v) => t(v))) {
    body.address = {
      line1: t(f.line1),
      line2: t(f.line2) || undefined,
      landmark: t(f.landmark) || undefined,
      city: t(f.city),
      state: t(f.state),
      pincode: t(f.pincode),
    }
  }
  return body
}

export default function StoreSettingsPage() {
  const { data: store, isLoading } = useQuery({ queryKey: keys.me, queryFn: api.me })
  if (isLoading || !store) return <Skeleton className="h-96" />
  return <StoreSettingsForm store={store} />
}

function StoreSettingsForm({ store }) {
  const qc = useQueryClient()
  const { can } = useAdminAccess()
  const canEdit = can('store', 'manage')
  const [form, setForm] = useState(() => toForm(store))
  const [errors, setErrors] = useState({})

  const save = useMutation({
    mutationFn: () => api.updateProfile(toBody(form)),
    onSuccess: (saved) => {
      qc.setQueryData(keys.me, saved)
      setForm(toForm(saved))
      setErrors({})
      toast.success('Store settings saved')
    },
    onError: (err) => {
      const e = parseApiError(err)
      const fieldErrors = Object.fromEntries((e.details ?? []).filter((d) => d.path).map((d) => [String(d.path).split('.').at(-1), d.message]))
      setErrors(fieldErrors)
      toast.error(Object.keys(fieldErrors).length ? 'Check the highlighted fields' : errorMessage(err))
    },
  })

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const input =
    (k, props = {}) =>
    (p) => <Input {...p} value={form[k]} onChange={set(k)} disabled={!canEdit} {...props} />

  return (
    <>
      <title>Store settings</title>
      <PageHeader
        title="Store settings"
        description="How your own store appears to buyers, and where couriers collect its orders."
        meta={
          <span className="inline-flex items-center gap-1 rounded-sm bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">
            <BadgeCheck className="size-3.5" /> Official store
          </span>
        }
        actions={
          store.store?.slug && (
            <Button asChild variant="outline">
              <a href={`/store/${store.store.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink /> View store
              </a>
            </Button>
          )
        }
      />

      {!store.readyToShip && (
        <Alert tone="warning" icon={Truck} title="Add a pickup phone and address before your first shipment" className="mb-5">
          Couriers need them to collect orders. You can list products and accept orders in the meantime.
        </Alert>
      )}
      {!canEdit && (
        <Alert tone="neutral" className="mb-5">
          You have view-only access to the store.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Storefront" description="Shown on product pages, the cart and your store page." />
          <CardBody className="flex flex-col gap-4">
            <Field label="Store name" required error={errors.storeName} hint="Buyers see this as the seller name.">
              {input('storeName', { maxLength: 120 })}
            </Field>
            <Field label="About the store" hint="Optional. Shown on your store page.">
              {(p) => <Textarea {...p} rows={3} maxLength={2000} value={form.storeDescription} onChange={set('storeDescription')} disabled={!canEdit} />}
            </Field>
            <Field label="Logo">
              {() => (
                <ImageUploader
                  audience="admin"
                  uploadPath="/store/media"
                  folder="vendors"
                  max={1}
                  compact
                  label="Upload logo"
                  value={form.logo}
                  onChange={(logo) => canEdit && setForm({ ...form, logo })}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact & billing" description="Used for courier pickups and on the store's invoices." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person" error={errors.contactName}>
              {input('contactName', { maxLength: 120 })}
            </Field>
            <Field label="Pickup phone" error={errors.phone}>
              {input('phone', { prefix: '+91', inputMode: 'numeric', maxLength: 10, className: 'pl-11' })}
            </Field>
            <Field
              label="WhatsApp number"
              error={errors.whatsapp}
              hint="For “Chat on WhatsApp” on the store's products. Empty = the pickup phone."
              className="sm:col-span-2"
            >
              {input('whatsapp', { prefix: '+91', inputMode: 'numeric', maxLength: 10, className: 'pl-11' })}
            </Field>
            <Field label="Email" error={errors.email} className="sm:col-span-2">
              {input('email', { type: 'email' })}
            </Field>
            <Field label="Legal business name" error={errors.legalName}>
              {input('legalName', { maxLength: 200 })}
            </Field>
            <Field label="GSTIN" error={errors.gstin}>
              {input('gstin', { maxLength: 15, className: 'font-mono uppercase' })}
            </Field>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Pickup address" description="Where couriers collect this store's orders. Changing it registers a new pickup location." />
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Address line 1" error={errors.line1} className="sm:col-span-2 lg:col-span-3">
              {input('line1', { placeholder: 'Shop / warehouse no., building, street' })}
            </Field>
            <Field label="Address line 2" className="sm:col-span-2">
              {input('line2')}
            </Field>
            <Field label="Landmark">{input('landmark')}</Field>
            <Field label="Pincode" error={errors.pincode}>
              {input('pincode', { inputMode: 'numeric', maxLength: 6 })}
            </Field>
            <Field label="City / district" error={errors.city}>
              {input('city')}
            </Field>
            <Field label="State" error={errors.state}>
              {(p) => (
                <Select {...p} placeholder="Select state" value={form.state} onChange={set('state')} disabled={!canEdit}>
                  {INDIAN_STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              )}
            </Field>
          </CardBody>
        </Card>
      </div>

      {canEdit && (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <Link to="/admin/store" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            Back to store dashboard
          </Link>
          <Button loading={save.isPending} disabled={!form.storeName.trim()} onClick={() => save.mutate()}>
            Save settings
          </Button>
        </div>
      )}
    </>
  )
}
