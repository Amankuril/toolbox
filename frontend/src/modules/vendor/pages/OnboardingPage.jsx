import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Check, CircleCheckBig, FileText, Landmark, LogOut, MapPin, PencilLine, Send, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { signOutEverywhere } from '@/core/api/http'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { sessions } from '@/core/auth/session'
import { BUSINESS_TYPES, GST_STATE_CODES, INDIAN_STATES, VENDOR_DOCUMENTS } from '@/core/lib/constants'
import { cn } from '@/core/lib/cn'
import { addressFields, gstin, ifsc, pan, required } from '@/core/lib/validators'
import { Logo } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader } from '@/ui/Card'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { DescriptionList } from '@/ui/PageHeader'
import { FullPageLoader } from '@/ui/Spinner'
import { useVendor, vendorApi, vendorKeys } from '../api'

const STEPS = [
  { key: 'business', label: 'Business details', hint: 'GSTIN, PAN & store', icon: Building2 },
  { key: 'address', label: 'Pickup address', hint: 'Where orders ship from', icon: MapPin },
  { key: 'bank', label: 'Bank account', hint: 'For payouts', icon: Landmark },
  { key: 'documents', label: 'Documents', hint: 'GST & cheque', icon: FileText },
  { key: 'review', label: 'Review & submit', hint: 'Send for approval', icon: Send },
]

function useSaveStep(fn, form, onSaved) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (vendor) => {
      qc.setQueryData(vendorKeys.me, vendor)
      sessions.vendor.getState().setAccount(vendor)
      onSaved(vendor)
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })
}

export default function OnboardingPage() {
  const vendor = useVendor()
  const navigate = useNavigate()
  const [active, setActive] = useState(null)

  if (!vendor) return <FullPageLoader />
  if (vendor.status === 'approved') return <Navigate to="/vendor" replace />

  const editable = ['onboarding', 'rejected'].includes(vendor.status)
  const completed = vendor.onboarding.completedSteps
  const firstIncomplete = STEPS.find((s) => s.key !== 'review' && !completed.includes(s.key))?.key ?? 'review'
  const current = editable ? (active ?? firstIncomplete) : 'submitted'
  const goNext = (from) => () => setActive(STEPS[STEPS.findIndex((s) => s.key === from) + 1]?.key ?? 'review')

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo to="/vendor" suffix="Seller" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/vendor">Save &amp; exit</Link>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              onClick={async () => {
                await signOutEverywhere('vendor')
                navigate('/vendor/login', { replace: true })
              }}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Set up {vendor.store?.name}</h1>
          <p className="mt-1 text-sm text-slate-500">Your progress is saved after every step. We verify these details before your store goes live.</p>
        </div>

        {vendor.status === 'rejected' && vendor.review?.note && (
          <Alert tone="warning" icon={TriangleAlert} title="Our team requested changes" className="mb-6">
            {vendor.review.note}
          </Alert>
        )}

        <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
            {STEPS.map((s, i) => {
              const done = s.key === 'review' ? vendor.status === 'pending_review' : completed.includes(s.key)
              const reachable = editable && (done || s.key === firstIncomplete || completed.includes(STEPS[i - 1]?.key) || i === 0)
              const isCurrent = current === s.key
              return (
                <li key={s.key} className="shrink-0">
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => setActive(s.key)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed',
                      isCurrent ? 'bg-white shadow-sm ring-1 ring-slate-200' : 'hover:bg-white/70',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold',
                        done ? 'bg-accent text-accent-fg' : isCurrent ? 'bg-primary text-primary-fg' : 'bg-slate-200 text-slate-500',
                      )}
                    >
                      {done ? <Check className="size-4" /> : i + 1}
                    </span>
                    <span className="hidden min-w-0 sm:block">
                      <span className={cn('block text-sm font-medium', isCurrent ? 'text-slate-900' : 'text-slate-700')}>{s.label}</span>
                      <span className="block text-xs text-slate-500">{s.hint}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="min-w-0">
            {current === 'business' && <BusinessStep vendor={vendor} onSaved={goNext('business')} />}
            {current === 'address' && <AddressStep vendor={vendor} onSaved={goNext('address')} onBack={() => setActive('business')} />}
            {current === 'bank' && <BankStep vendor={vendor} onSaved={goNext('bank')} onBack={() => setActive('address')} />}
            {current === 'documents' && <DocumentsStep vendor={vendor} onSaved={goNext('documents')} onBack={() => setActive('bank')} />}
            {current === 'review' && <ReviewStep vendor={vendor} onEdit={setActive} />}
            {current === 'submitted' && <Submitted vendor={vendor} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepActions({ onBack, loading, label = 'Save & continue' }) {
  return (
    <div className="flex justify-between gap-2 border-t border-slate-100 pt-5 sm:col-span-2">
      {onBack ? (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      ) : (
        <span />
      )}
      <Button type="submit" loading={loading}>
        {label}
      </Button>
    </div>
  )
}

/* ─────────────── Business ─────────────── */

const businessSchema = z
  .object({
    legalName: required('Legal business name', 200),
    type: z.string().min(1, 'Choose a business type'),
    gstin,
    pan,
    yearEstablished: z.union([z.literal(''), z.coerce.number().int().min(1900).max(new Date().getFullYear())]).optional(),
    storeName: required('Store name', 120),
    storeDescription: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.gstin.slice(2, 12) === v.pan, { path: ['pan'], message: 'PAN does not match the GSTIN' })

function BusinessStep({ vendor, onSaved }) {
  const form = useForm({
    resolver: zodResolver(businessSchema),
    defaultValues: {
      legalName: vendor.business?.legalName ?? '',
      type: vendor.business?.type ?? '',
      gstin: vendor.business?.gstin ?? '',
      pan: vendor.business?.pan ?? '',
      yearEstablished: vendor.business?.yearEstablished ?? '',
      storeName: vendor.store?.name ?? '',
      storeDescription: vendor.store?.description ?? '',
    },
  })
  const save = useSaveStep(vendorApi.saveBusiness, form, onSaved)
  const e = form.formState.errors

  const autofillPan = (value) => {
    const g = value.trim().toUpperCase()
    if (/^\d{2}[A-Z]{5}\d{4}[A-Z]/.test(g) && !form.getValues('pan')) form.setValue('pan', g.slice(2, 12), { shouldValidate: true })
  }

  return (
    <Card>
      <CardHeader title="Business details" description="Enter them exactly as on your GST registration." />
      <CardBody>
        <form
          onSubmit={form.handleSubmit(({ yearEstablished, ...v }) =>
            save.mutate({ ...v, ...(yearEstablished ? { yearEstablished: Number(yearEstablished) } : {}) }),
          )}
          className="grid gap-5 sm:grid-cols-2"
          noValidate
        >
          <Field label="Legal business name" required error={e.legalName?.message} className="sm:col-span-2">
            {(p) => <Input {...p} autoFocus {...form.register('legalName')} />}
          </Field>
          <Field label="Business type" required error={e.type?.message}>
            {(p) => (
              <Select {...p} placeholder="Select…" {...form.register('type')}>
                {BUSINESS_TYPES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Year established" error={e.yearEstablished?.message}>
            {(p) => <Input {...p} inputMode="numeric" maxLength={4} placeholder="e.g. 2012" {...form.register('yearEstablished')} />}
          </Field>
          <Field label="GSTIN" required error={e.gstin?.message} hint="15 characters, e.g. 27AAPFU0939F1ZV">
            {(p) => (
              <Input {...p} className="font-mono uppercase" maxLength={15} {...form.register('gstin', { onBlur: (ev) => autofillPan(ev.target.value) })} />
            )}
          </Field>
          <Field label="PAN" required error={e.pan?.message} hint="Filled from your GSTIN">
            {(p) => <Input {...p} className="font-mono uppercase" maxLength={10} {...form.register('pan')} />}
          </Field>
          <Field label="Store name" required error={e.storeName?.message} hint="What buyers see" className="sm:col-span-2">
            {(p) => <Input {...p} {...form.register('storeName')} />}
          </Field>
          <Field label="About your store" hint="Brands you carry, years in business, service areas" className="sm:col-span-2">
            {(p) => <Textarea {...p} rows={3} {...form.register('storeDescription')} />}
          </Field>
          <StepActions loading={save.isPending} />
        </form>
      </CardBody>
    </Card>
  )
}

/* ─────────────── Address ─────────────── */

const addressSchema = z.object(addressFields)

function AddressStep({ vendor, onSaved, onBack }) {
  const a = vendor.address ?? {}
  const form = useForm({
    resolver: zodResolver(addressSchema),
    defaultValues: {
      line1: a.line1 ?? '',
      line2: a.line2 ?? '',
      landmark: a.landmark ?? '',
      city: a.city ?? '',
      state: a.state ?? GST_STATE_CODES[vendor.business?.gstin?.slice(0, 2)] ?? '',
      pincode: a.pincode ?? '',
    },
  })
  const save = useSaveStep(vendorApi.saveAddress, form, onSaved)
  const e = form.formState.errors
  return (
    <Card>
      <CardHeader title="Pickup address" description="Orders are collected from here. Usually your warehouse or shop." />
      <CardBody>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-5 sm:grid-cols-2" noValidate>
          <Field label="Address line 1" required error={e.line1?.message} className="sm:col-span-2">
            {(p) => <Input {...p} autoComplete="address-line1" placeholder="Building, street" autoFocus {...form.register('line1')} />}
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            {(p) => <Input {...p} autoComplete="address-line2" placeholder="Area, industrial estate" {...form.register('line2')} />}
          </Field>
          <Field label="Landmark">{(p) => <Input {...p} {...form.register('landmark')} />}</Field>
          <Field label="City" required error={e.city?.message}>
            {(p) => <Input {...p} autoComplete="address-level2" {...form.register('city')} />}
          </Field>
          <Field label="State" required error={e.state?.message}>
            {(p) => (
              <Select {...p} placeholder="Select state" {...form.register('state')}>
                {INDIAN_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Pincode" required error={e.pincode?.message}>
            {(p) => <Input {...p} inputMode="numeric" maxLength={6} autoComplete="postal-code" {...form.register('pincode')} />}
          </Field>
          <StepActions onBack={onBack} loading={save.isPending} />
        </form>
      </CardBody>
    </Card>
  )
}

/* ─────────────── Bank ─────────────── */

const bankSchema = z
  .object({
    accountHolderName: required('Account holder name', 120),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits'),
    confirmAccountNumber: z.string().trim(),
    ifsc,
    bankName: required('Bank name', 120),
    branch: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.accountNumber === v.confirmAccountNumber, { path: ['confirmAccountNumber'], message: 'Account numbers do not match' })

function BankStep({ vendor, onSaved, onBack }) {
  const [replacing, setReplacing] = useState(!vendor.bank)
  const form = useForm({
    resolver: zodResolver(bankSchema),
    defaultValues: {
      accountHolderName: vendor.bank?.accountHolderName ?? vendor.business?.legalName ?? '',
      accountNumber: '',
      confirmAccountNumber: '',
      ifsc: '',
      bankName: '',
      branch: '',
    },
  })
  const save = useSaveStep(vendorApi.saveBank, form, onSaved)
  const e = form.formState.errors

  if (!replacing) {
    return (
      <Card>
        <CardHeader title="Bank account" description="Payouts are settled to this account." />
        <CardBody className="flex flex-col gap-5">
          <DescriptionList
            items={[
              ['Account holder', vendor.bank.accountHolderName],
              [
                'Account number',
                <span key="n" className="font-mono">
                  {vendor.bank.accountNumberMasked}
                </span>,
              ],
              [
                'IFSC',
                <span key="i" className="font-mono">
                  {vendor.bank.ifsc}
                </span>,
              ],
              ['Bank', [vendor.bank.bankName, vendor.bank.branch].filter(Boolean).join(', ')],
            ]}
          />
          <div className="flex justify-between gap-2 border-t border-slate-100 pt-5">
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setReplacing(true)}>
                <PencilLine /> Change account
              </Button>
              <Button onClick={() => onSaved(vendor)}>Continue</Button>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Bank account" description="Must be a current account in the business's name. Encrypted and only used for payouts." />
      <CardBody>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-5 sm:grid-cols-2" noValidate autoComplete="off">
          <Field label="Account holder name" required error={e.accountHolderName?.message} className="sm:col-span-2">
            {(p) => <Input {...p} {...form.register('accountHolderName')} />}
          </Field>
          <Field label="Account number" required error={e.accountNumber?.message}>
            {(p) => <Input {...p} inputMode="numeric" className="font-mono" {...form.register('accountNumber')} />}
          </Field>
          <Field label="Re-enter account number" required error={e.confirmAccountNumber?.message}>
            {(p) => <Input {...p} inputMode="numeric" className="font-mono" onPaste={(ev) => ev.preventDefault()} {...form.register('confirmAccountNumber')} />}
          </Field>
          <Field label="IFSC" required error={e.ifsc?.message} hint="11 characters, e.g. HDFC0001234">
            {(p) => <Input {...p} className="font-mono uppercase" maxLength={11} {...form.register('ifsc')} />}
          </Field>
          <Field label="Bank name" required error={e.bankName?.message}>
            {(p) => <Input {...p} {...form.register('bankName')} />}
          </Field>
          <Field label="Branch" className="sm:col-span-2">
            {(p) => <Input {...p} {...form.register('branch')} />}
          </Field>
          <StepActions onBack={vendor.bank ? () => setReplacing(false) : onBack} loading={save.isPending} />
        </form>
      </CardBody>
    </Card>
  )
}

/* ─────────────── Documents ─────────────── */

function DocumentsStep({ vendor, onSaved, onBack }) {
  const initial = Object.fromEntries(
    VENDOR_DOCUMENTS.map((d) => [d.value, vendor.documents.filter((x) => x.type === d.value).map((x) => ({ media: x.media, url: x.url }))]),
  )
  const form = useForm({ defaultValues: initial })
  const save = useSaveStep(vendorApi.saveDocuments, form, onSaved)
  const [missing, setMissing] = useState([])

  const submit = form.handleSubmit((values) => {
    const lacking = VENDOR_DOCUMENTS.filter((d) => d.required && !values[d.value]?.length).map((d) => d.value)
    setMissing(lacking)
    if (lacking.length) return
    save.mutate({ documents: VENDOR_DOCUMENTS.flatMap((d) => (values[d.value] ?? []).map((img) => ({ type: d.value, media: img.media }))) })
  })

  return (
    <Card>
      <CardHeader title="Documents" description="Clear photos or scans. We use these only to verify your business." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-6 sm:grid-cols-2" noValidate>
          {VENDOR_DOCUMENTS.map((d) => (
            <div key={d.value}>
              <p className="mb-1.5 text-sm font-medium text-slate-800">
                {d.label} {d.required ? <span className="text-red-600">*</span> : <span className="text-xs font-normal text-slate-500">(optional)</span>}
              </p>
              <Controller
                name={d.value}
                control={form.control}
                render={({ field }) => (
                  <ImageUploader
                    audience="vendor"
                    folder="documents"
                    max={1}
                    aspect="aspect-[4/3]"
                    value={field.value}
                    onChange={(v) => {
                      field.onChange(v)
                      setMissing((m) => m.filter((x) => x !== d.value))
                    }}
                    compact
                    label="Upload"
                  />
                )}
              />
              {missing.includes(d.value) && <p className="mt-1 text-xs font-medium text-red-600">{d.label} is required</p>}
            </div>
          ))}
          <StepActions onBack={onBack} loading={save.isPending} />
        </form>
      </CardBody>
    </Card>
  )
}

/* ─────────────── Review ─────────────── */

function ReviewStep({ vendor, onEdit }) {
  const qc = useQueryClient()
  const submit = useMutation({
    mutationFn: vendorApi.submit,
    onSuccess: (v) => {
      qc.setQueryData(vendorKeys.me, v)
      sessions.vendor.getState().setAccount(v)
      toast.success(v.status === 'approved' ? 'Your store is approved — start listing products!' : 'Application submitted')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const sections = [
    {
      key: 'business',
      title: 'Business',
      items: [
        ['Legal name', vendor.business?.legalName],
        ['GSTIN', vendor.business?.gstin],
        ['PAN', vendor.business?.pan],
        ['Store', vendor.store?.name],
      ],
    },
    {
      key: 'address',
      title: 'Pickup address',
      items: [['Address', vendor.address && `${vendor.address.line1}, ${vendor.address.city}, ${vendor.address.state} ${vendor.address.pincode}`]],
    },
    {
      key: 'bank',
      title: 'Bank account',
      items: [
        ['Account', vendor.bank && `${vendor.bank.accountNumberMasked} · ${vendor.bank.ifsc}`],
        ['Holder', vendor.bank?.accountHolderName],
      ],
    },
    { key: 'documents', title: 'Documents', items: [['Uploaded', `${vendor.documents.length} document(s)`]] },
  ]
  return (
    <Card>
      <CardHeader title="Review & submit" description="Check everything once more. Details are locked while we review them." />
      <CardBody className="flex flex-col gap-5">
        {sections.map((s) => (
          <div key={s.key} className="rounded-lg border border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
              <Button variant="link" size="sm" onClick={() => onEdit(s.key)}>
                Edit
              </Button>
            </div>
            <DescriptionList items={s.items} />
          </div>
        ))}
        <div className="flex justify-end border-t border-slate-100 pt-5">
          <Button size="lg" loading={submit.isPending} onClick={() => submit.mutate()}>
            <Send /> Submit for approval
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function Submitted({ vendor }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center py-14 text-center">
        <div className="mb-5 grid size-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <CircleCheckBig className="size-7" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Application submitted</h2>
        <p className="mt-2 max-w-md text-sm text-slate-600">
          Thanks, {vendor.contactName.split(' ')[0]}! We&apos;re verifying your details. Check back here — your dashboard updates as soon as your store is
          approved.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/vendor">Go to dashboard</Link>
        </Button>
      </CardBody>
    </Card>
  )
}
