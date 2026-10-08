import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Lock } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage, parseApiError } from '@/core/api/errors'
import { sessions } from '@/core/auth/session'
import { BUSINESS_TYPES } from '@/core/lib/constants'
import { formatPhone } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'
import { Field, Input, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { PhoneInput } from '@/ui/inputs'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { useVendor, vendorApi, vendorKeys } from '../api'

const businessLabel = Object.fromEntries(BUSINESS_TYPES.map((b) => [b.value, b.label]))

export default function VendorProfilePage() {
  const vendor = useVendor()
  const qc = useQueryClient()
  const [draft, setDraft] = useState(null)
  const v = draft ?? {
    storeName: vendor.store?.name ?? '',
    storeDescription: vendor.store?.description ?? '',
    logo: vendor.store?.logo ? [vendor.store.logo] : [],
    contactName: vendor.contactName,
    email: vendor.email,
    whatsapp: vendor.store?.whatsapp?.replace(/^\+91/, '') ?? '',
  }
  const set = (patch) => setDraft({ ...v, ...patch })

  const save = useMutation({
    mutationFn: () =>
      vendorApi.updateProfile({
        storeName: v.storeName.trim(),
        storeDescription: v.storeDescription,
        logo: v.logo[0] ? { media: v.logo[0].media } : null,
        contactName: v.contactName.trim(),
        email: v.email.trim(),
        whatsapp: v.whatsapp,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(vendorKeys.me, updated)
      sessions.vendor.getState().setAccount(updated)
      setDraft(null)
      toast.success('Store profile saved')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const fields = save.error ? parseApiError(save.error).fields : {}

  return (
    <>
      <PageHeader
        title="Store profile"
        meta={<StatusBadge status={vendor.status} />}
        actions={
          vendor.status === 'approved' && (
            <Button variant="outline" asChild>
              <Link to={`/store/${vendor.store.slug}`} target="_blank">
                <ExternalLink /> View store
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Public profile" description="What buyers see on your store page and product listings." />
          <CardBody className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-medium text-slate-800">Store logo</p>
              <div className="max-w-40">
                <ImageUploader audience="vendor" folder="vendors" max={1} value={v.logo} onChange={(logo) => set({ logo })} compact label="Upload logo" />
              </div>
            </div>
            <Field label="Store name" required error={fields.storeName} className="sm:col-span-2">
              {(p) => <Input {...p} value={v.storeName} maxLength={120} onChange={(e) => set({ storeName: e.target.value })} />}
            </Field>
            <Field label="About your store" className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={4} value={v.storeDescription} maxLength={2000} onChange={(e) => set({ storeDescription: e.target.value })} />}
            </Field>
            <Field label="Contact name" required error={fields.contactName}>
              {(p) => <Input {...p} value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} />}
            </Field>
            <Field label="Email" required error={fields.email}>
              {(p) => <Input {...p} type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />}
            </Field>
            <Field
              label="WhatsApp number"
              error={fields.whatsapp}
              hint={`Buyers tap “Chat on WhatsApp” on your products to reach this number. Empty = your mobile ${formatPhone(vendor.phone)}.`}
              className="sm:col-span-2"
            >
              {(p) => <PhoneInput {...p} className="max-w-xs" value={v.whatsapp} onChange={(whatsapp) => set({ whatsapp })} />}
            </Field>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-5 sm:col-span-2">
              <Button variant="outline" disabled={!draft} onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button loading={save.isPending} disabled={!draft || !v.storeName.trim()} onClick={() => save.mutate()}>
                Save profile
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Verified details" action={<Lock className="size-4 text-slate-400" />} />
            <CardBody className="flex flex-col gap-4">
              <DescriptionList
                className="sm:grid-cols-1"
                items={[
                  ['Mobile', formatPhone(vendor.phone)],
                  ['Legal name', vendor.business?.legalName],
                  ['Business type', businessLabel[vendor.business?.type]],
                  ['GSTIN', vendor.business?.gstin && <span className="font-mono">{vendor.business.gstin}</span>],
                  ['Pickup address', vendor.address && `${vendor.address.line1}, ${vendor.address.city}, ${vendor.address.state} ${vendor.address.pincode}`],
                  ['Payout account', vendor.bank && `${vendor.bank.accountNumberMasked} · ${vendor.bank.ifsc}`],
                ]}
              />
              <p className="text-xs text-slate-500">
                {['onboarding', 'rejected'].includes(vendor.status) ? (
                  <>
                    Edit these in{' '}
                    <Link to="/vendor/onboarding" className="font-medium text-primary hover:underline">
                      store setup
                    </Link>
                    .
                  </>
                ) : (
                  'These were verified during approval. Contact support to change them.'
                )}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
