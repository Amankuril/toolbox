import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Send, Trash2, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { GST_RATES, PRODUCT_CONDITIONS, PRODUCT_TYPES, PRODUCT_UNITS } from '@/core/lib/constants'
import { formatINR } from '@/core/lib/format'
import { required } from '@/core/lib/validators'
import { StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { Combobox } from '@/ui/Combobox'
import { SegmentedControl } from '@/ui/Controls'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { NumberInput, PriceInput, TagInput } from '@/ui/inputs'
import { PageHeader } from '@/ui/PageHeader'
import { useVendor, vendorApi, vendorKeys } from '../api'
import { CategoryDialog } from '../components/CategoryDialog'
import { useCategoryOptions } from '../components/categoryOptions'
import { CompatibilityPicker } from '../components/CompatibilityPicker'

const optNum = (schema) => schema.optional()
const schema = z
  .object({
    type: z.enum(['tool', 'machinery', 'part']),
    name: required('Product name', 200),
    category: z.string().min(1, 'Choose a category'),
    brand: z.string().trim().max(80).optional(),
    modelNumber: z.string().trim().max(80).optional(),
    sku: z.string().trim().max(64).optional(),
    shortDescription: z.string().trim().max(500).optional(),
    description: z.string().trim().max(20_000).optional(),
    images: z.array(z.object({ media: z.string(), url: z.string(), alt: z.string().optional() })).max(10),
    pricing: z.object({
      mrp: z.number({ error: 'Enter the MRP' }).int().min(1, 'Enter the MRP'),
      price: z.number({ error: 'Enter the selling price' }).int().min(1, 'Enter the selling price'),
      gstRate: z.coerce.number(),
    }),
    hsnCode: z
      .string()
      .trim()
      .regex(/^(\d{4}|\d{6}|\d{8})?$/, 'HSN must be 4, 6 or 8 digits')
      .optional(),
    inventory: z.object({
      stock: z.number({ error: 'Enter available stock' }).int().min(0),
      moq: z.number({ error: 'Minimum is 1' }).int().min(1),
      maxOrderQty: optNum(z.number().int().min(1)),
      unit: z.string(),
    }),
    condition: z.enum(['new', 'refurbished', 'used']),
    warranty: z.object({ months: optNum(z.number().int().min(0).max(240)), details: z.string().trim().max(500).optional() }),
    shipping: z.object({ weightKg: optNum(z.number().min(0)), dispatchDays: optNum(z.number().int().min(0).max(60)) }),
    specifications: z.array(z.object({ label: required('Label', 80), value: required('Value', 300) })).max(50),
    compatibleWith: z.array(z.object({ _id: z.string(), name: z.string() }).loose()).max(100),
    compatibleModels: z.array(z.string()).max(100),
    tags: z.array(z.string()).max(20),
  })
  .refine((v) => v.pricing.price <= v.pricing.mrp, { path: ['pricing', 'price'], message: 'Selling price cannot be more than MRP' })
  .refine((v) => !v.inventory.maxOrderQty || v.inventory.maxOrderQty >= v.inventory.moq, {
    path: ['inventory', 'maxOrderQty'],
    message: 'Must be at least the minimum order',
  })

const EMPTY = {
  type: 'tool',
  name: '',
  category: '',
  brand: '',
  modelNumber: '',
  sku: '',
  shortDescription: '',
  description: '',
  images: [],
  pricing: { mrp: undefined, price: undefined, gstRate: 18 },
  hsnCode: '',
  inventory: { stock: undefined, moq: 1, maxOrderQty: undefined, unit: 'piece' },
  condition: 'new',
  warranty: { months: undefined, details: '' },
  shipping: { weightKg: undefined, dispatchDays: 2 },
  specifications: [],
  compatibleWith: [],
  compatibleModels: [],
  tags: [],
}

function toForm(p) {
  return {
    ...EMPTY,
    type: p.type,
    name: p.name,
    category: String(p.category?._id ?? p.category),
    brand: p.brand ?? '',
    modelNumber: p.modelNumber ?? '',
    sku: p.sku ?? '',
    shortDescription: p.shortDescription ?? '',
    description: p.description ?? '',
    images: p.images,
    pricing: { mrp: p.pricing.mrp, price: p.pricing.price, gstRate: p.pricing.gstRate },
    hsnCode: p.hsnCode ?? '',
    inventory: { stock: p.inventory.stock, moq: p.inventory.moq, maxOrderQty: p.inventory.maxOrderQty ?? undefined, unit: p.inventory.unit },
    condition: p.condition,
    warranty: { months: p.warranty?.months ?? undefined, details: p.warranty?.details ?? '' },
    shipping: { weightKg: p.shipping?.weightKg ?? undefined, dispatchDays: p.shipping?.dispatchDays ?? undefined },
    specifications: p.specifications,
    compatibleWith: p.compatibleWith,
    compatibleModels: p.compatibleModels,
    tags: p.tags,
  }
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''))

function toPayload(v) {
  const isPart = v.type === 'part'
  return {
    type: v.type,
    name: v.name,
    category: v.category,
    brand: v.brand,
    modelNumber: v.modelNumber,
    sku: v.sku,
    shortDescription: v.shortDescription,
    description: v.description,
    images: v.images.map(({ media, alt }) => clean({ media, alt })),
    pricing: v.pricing,
    hsnCode: v.hsnCode,
    inventory: clean(v.inventory),
    condition: v.condition,
    warranty: clean(v.warranty),
    shipping: clean(v.shipping),
    specifications: v.specifications,
    compatibleWith: isPart ? v.compatibleWith.map((c) => c._id) : [],
    compatibleModels: isPart ? v.compatibleModels : [],
    tags: v.tags,
  }
}

export default function ProductFormPage() {
  const { id } = useParams()
  const isNew = !id
  const vendor = useVendor()
  const { data: product, isLoading } = useQuery({ queryKey: vendorKeys.product(id), queryFn: () => vendorApi.product(id), enabled: !isNew })

  if (vendor && vendor.status !== 'approved') return <Navigate to="/vendor/products" replace />
  if (!isNew && (isLoading || !product)) return <Skeleton className="h-[60vh]" />
  return <ProductForm key={product?._id ?? 'new'} product={product} />
}

function ProductForm({ product }) {
  const isNew = !product
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [proposeOpen, setProposeOpen] = useState(false)
  const categoryOptions = useCategoryOptions()
  const form = useForm({ resolver: zodResolver(schema), defaultValues: product ? toForm(product) : EMPTY })
  const { control, register, formState, setValue } = form
  const e = formState.errors
  const specs = useFieldArray({ control, name: 'specifications' })
  const type = useWatch({ control, name: 'type' })
  const pricing = useWatch({ control, name: 'pricing' })

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (ev) => {
      if (form.formState.isDirty) ev.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [form.formState])

  const save = useMutation({
    mutationFn: ({ values, publish }) => {
      const body = { ...toPayload(values), ...(publish !== undefined ? { publish } : {}) }
      return isNew ? vendorApi.createProduct(body) : vendorApi.updateProduct(product._id, body)
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ['vendor', 'products'] })
      qc.setQueryData(vendorKeys.product(saved._id), saved)
      qc.invalidateQueries({ queryKey: vendorKeys.dashboard })
      form.reset(toForm(saved))
      const messages = { active: 'Saved — your product is live', pending: 'Submitted for review', draft: 'Draft saved' }
      toast.success(messages[saved.status] ?? 'Product saved')
      navigate(`/vendor/products/${saved._id}`, { replace: true })
    },
    onError: (err) => {
      if (!applyFieldErrors(err, form.setError)) toast.error(errorMessage(err))
      else toast.error('Please fix the highlighted fields')
    },
  })

  const submit = (publish) =>
    form.handleSubmit(
      (values) => save.mutate({ values, publish }),
      () => toast.error('Please fix the highlighted fields'),
    )
  const status = product?.status
  const canSubmit = isNew || ['draft', 'rejected'].includes(status)
  const discount = pricing?.mrp > pricing?.price ? Math.round(((pricing.mrp - pricing.price) / pricing.mrp) * 100) : 0

  return (
    <form onSubmit={(ev) => ev.preventDefault()} noValidate className="pb-24">
      <PageHeader
        back={{ to: '/vendor/products', label: 'Products' }}
        title={isNew ? 'Add product' : product.name}
        meta={status && <StatusBadge status={status} />}
        description={isNew ? 'New listings are reviewed before they go live.' : undefined}
      />

      {status === 'rejected' && product.moderation?.note && (
        <Alert tone="warning" icon={TriangleAlert} title="Changes requested by our team" className="mb-6">
          {product.moderation.note}
        </Alert>
      )}
      {status === 'pending' && (
        <Alert tone="info" className="mb-6">
          This product is being reviewed. You can still edit it.
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Basics" />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-sm font-medium text-slate-800">What are you listing?</p>
                <Controller
                  name="type"
                  control={control}
                  render={({ field }) => <SegmentedControl value={field.value} onChange={field.onChange} options={PRODUCT_TYPES} />}
                />
              </div>
              <Field
                label="Product name"
                required
                error={e.name?.message}
                hint="Brand + product + key spec, e.g. “Bosch GSB 550 Impact Drill 13mm”"
                className="sm:col-span-2"
              >
                {(p) => <Input {...p} {...register('name')} />}
              </Field>
              <Field
                label="Category"
                required
                error={e.category?.message}
                className="sm:col-span-2"
                labelAction={
                  <button type="button" onClick={() => setProposeOpen(true)} className="text-xs font-medium text-primary hover:underline">
                    Can&apos;t find it? Propose one
                  </button>
                }
              >
                {(p) => (
                  <Controller
                    name="category"
                    control={control}
                    render={({ field }) => (
                      <Combobox
                        {...p}
                        invalid={Boolean(e.category)}
                        options={categoryOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select a category"
                        searchPlaceholder="Search categories"
                      />
                    )}
                  />
                )}
              </Field>
              <Field label="Brand">{(p) => <Input {...p} {...register('brand')} placeholder="e.g. Bosch" />}</Field>
              <Field label="Model number">{(p) => <Input {...p} {...register('modelNumber')} placeholder="e.g. GSB 550" />}</Field>
              <Field label="SKU" error={e.sku?.message} hint="Your internal code, unique per product">
                {(p) => <Input {...p} {...register('sku')} />}
              </Field>
              <Field label="Condition">
                {(p) => (
                  <Select {...p} {...register('condition')}>
                    {PRODUCT_CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Photos" description="Clear photos on a plain background sell best. The first photo is the cover." />
            <CardBody>
              <Controller
                name="images"
                control={control}
                render={({ field }) => <ImageUploader audience="vendor" folder="products" max={10} value={field.value} onChange={field.onChange} />}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Description" />
            <CardBody className="flex flex-col gap-5">
              <Field label="Short description" error={e.shortDescription?.message} hint="One or two lines shown near the price">
                {(p) => <Textarea {...p} rows={2} maxLength={500} {...register('shortDescription')} />}
              </Field>
              <Field label="Full description" error={e.description?.message}>
                {(p) => <Textarea {...p} rows={8} {...register('description')} placeholder="Features, applications, what's in the box…" />}
              </Field>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">Specifications</p>
                  <Button variant="ghost" size="sm" onClick={() => specs.append({ label: '', value: '' })}>
                    <Plus /> Add row
                  </Button>
                </div>
                {specs.fields.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => specs.append({ label: '', value: '' })}
                    className="w-full rounded-lg border-2 border-dashed border-slate-200 py-5 text-sm text-slate-500 hover:border-slate-300"
                  >
                    Add specs like Power, Voltage, Weight…
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    {specs.fields.map((f, i) => (
                      <div key={f.id} className="flex items-start gap-2">
                        <div className="w-2/5">
                          <Input
                            placeholder="e.g. Power"
                            aria-label="Specification name"
                            aria-invalid={Boolean(e.specifications?.[i]?.label) || undefined}
                            {...register(`specifications.${i}.label`)}
                          />
                        </div>
                        <div className="flex-1">
                          <Input
                            placeholder="e.g. 550 W"
                            aria-label="Specification value"
                            aria-invalid={Boolean(e.specifications?.[i]?.value) || undefined}
                            {...register(`specifications.${i}.value`)}
                          />
                        </div>
                        <Button variant="ghost" size="icon" aria-label="Remove row" onClick={() => specs.remove(i)}>
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          {type === 'part' && (
            <Card>
              <CardHeader title="Compatibility" description="Link this part to the machines it fits, so buyers find it from the machine's page." />
              <CardBody className="flex flex-col gap-5">
                <Controller
                  name="compatibleWith"
                  control={control}
                  render={({ field }) => <CompatibilityPicker value={field.value} onChange={field.onChange} excludeId={product?._id} />}
                />
                <Field label="Also fits models" hint="Model numbers not listed on the store. Press Enter after each.">
                  {() => (
                    <Controller
                      name="compatibleModels"
                      control={control}
                      render={({ field }) => <TagInput value={field.value} onChange={field.onChange} max={100} placeholder="e.g. GSB 500 RE" />}
                    />
                  )}
                </Field>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Pricing" description="Prices include GST" />
            <CardBody className="flex flex-col gap-4">
              <Field label="MRP" required error={e.pricing?.mrp?.message}>
                {(p) => (
                  <Controller
                    name="pricing.mrp"
                    control={control}
                    render={({ field }) => <PriceInput {...p} value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <Field label="Selling price" required error={e.pricing?.price?.message} hint={discount > 0 ? `${discount}% off MRP` : undefined}>
                {(p) => (
                  <Controller
                    name="pricing.price"
                    control={control}
                    render={({ field }) => <PriceInput {...p} value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="GST rate">
                  {(p) => (
                    <Select {...p} {...register('pricing.gstRate')}>
                      {GST_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="HSN code" error={e.hsnCode?.message}>
                  {(p) => <Input {...p} inputMode="numeric" maxLength={8} {...register('hsnCode')} />}
                </Field>
              </div>
              {pricing?.price > 0 && (
                <p className="text-xs text-slate-500">
                  GST included: {formatINR(Math.round(pricing.price - pricing.price / (1 + Number(pricing.gstRate) / 100)))}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Inventory" />
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Stock" required error={e.inventory?.stock?.message} className="col-span-2">
                {(p) => (
                  <Controller
                    name="inventory.stock"
                    control={control}
                    render={({ field }) => <NumberInput {...p} value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <Field label="Unit">
                {(p) => (
                  <Select {...p} {...register('inventory.unit')}>
                    {PRODUCT_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Min. order" error={e.inventory?.moq?.message}>
                {(p) => (
                  <Controller
                    name="inventory.moq"
                    control={control}
                    render={({ field }) => <NumberInput {...p} min={1} value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <Field label="Max per order" error={e.inventory?.maxOrderQty?.message} hint="Optional" className="col-span-2">
                {(p) => (
                  <Controller
                    name="inventory.maxOrderQty"
                    control={control}
                    render={({ field }) => <NumberInput {...p} min={1} value={field.value} onChange={field.onChange} placeholder="No limit" />}
                  />
                )}
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Shipping & warranty" />
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Dispatch in (days)">
                {(p) => (
                  <Controller
                    name="shipping.dispatchDays"
                    control={control}
                    render={({ field }) => <NumberInput {...p} value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <Field label="Weight (kg)">
                {(p) => (
                  <Controller
                    name="shipping.weightKg"
                    control={control}
                    render={({ field }) => <NumberInput {...p} step="0.1" value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <Field label="Warranty (months)">
                {(p) => (
                  <Controller
                    name="warranty.months"
                    control={control}
                    render={({ field }) => <NumberInput {...p} value={field.value} onChange={field.onChange} />}
                  />
                )}
              </Field>
              <Field label="Warranty details">{(p) => <Input {...p} {...register('warranty.details')} placeholder="e.g. Manufacturer" />}</Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Search tags" description="Extra words buyers might search for" />
            <CardBody>
              <Controller
                name="tags"
                control={control}
                render={({ field }) => <TagInput value={field.value} onChange={field.onChange} placeholder="e.g. drilling, masonry" />}
              />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6">
          {!isNew && ['active', 'inactive', 'pending'].includes(status) && (
            <p className="mr-auto hidden text-xs text-slate-500 md:block">
              Changes to name, photos, description or specs may be re-reviewed before going live.
            </p>
          )}
          <Button variant="ghost" onClick={() => navigate('/vendor/products')}>
            Cancel
          </Button>
          {canSubmit ? (
            <>
              <Button variant="outline" loading={save.isPending && save.variables?.publish === false} onClick={submit(false)}>
                Save draft
              </Button>
              <Button loading={save.isPending && save.variables?.publish === true} onClick={submit(true)}>
                <Send /> Submit for review
              </Button>
            </>
          ) : (
            <Button loading={save.isPending} onClick={submit(undefined)}>
              Save changes
            </Button>
          )}
        </div>
      </div>

      <CategoryDialog
        open={proposeOpen}
        onOpenChange={setProposeOpen}
        onSaved={(c) => setValue('category', c._id, { shouldDirty: true, shouldValidate: true })}
      />
    </form>
  )
}
