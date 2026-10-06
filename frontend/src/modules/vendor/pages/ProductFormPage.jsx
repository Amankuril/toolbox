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
import { SegmentedControl, Switch } from '@/ui/Controls'
import { Checkbox, Field, Input, Select, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { NumberInput, PriceInput, TagInput } from '@/ui/inputs'
import { PageHeader } from '@/ui/PageHeader'
import { useVendor, vendorApi, vendorKeys } from '../api'
import { CategoryDialog } from '../components/CategoryDialog'
import { useCategoryOptions } from '../components/categoryOptions'
import { BulkPricingCard } from '../components/BulkPricingCard'
import { bulkTierIssues, MAX_TIERS } from '../components/bulkRules'
import { CompatibilityPicker } from '../components/CompatibilityPicker'
import { VariantsCard } from '../components/VariantsCard'

const optNum = (schema) => schema.optional()
const barcode = z
  .string()
  .trim()
  .regex(/^(\d{8}|\d{12,14}|\d{9}[\dXx])?$/, 'Use a UPC, EAN, GTIN or ISBN (8, 10, 12, 13 or 14 digits)')
  .optional()
const schema = z
  .object({
    type: z.enum(['tool', 'machinery', 'part']),
    name: required('Product name', 200),
    category: z.string().min(1, 'Choose a category'),
    brand: z.string().trim().max(80).optional(),
    modelNumber: z.string().trim().max(80).optional(),
    sku: z.string().trim().max(64).optional(),
    barcode,
    shortDescription: z.string().trim().max(500).optional(),
    description: z.string().trim().max(20_000).optional(),
    images: z.array(z.object({ media: z.string(), url: z.string(), alt: z.string().optional() })).max(10),
    // Required unless the product has variants (each variant then has its own price).
    pricing: z.object({
      mrp: optNum(z.number().int().min(1, 'Enter the MRP')),
      price: optNum(z.number().int().min(1, 'Enter the selling price')),
      gstRate: z.coerce.number({ error: 'Choose a GST rate' }),
    }),
    hsnCode: z
      .string()
      .trim()
      .regex(/^(\d{4}|\d{6}|\d{8})$/, 'Enter a 4, 6 or 8 digit HSN/SAC code'),
    inventory: z.object({
      trackQuantity: z.boolean(),
      available: z.boolean(),
      stock: optNum(z.number().int().min(0)),
      lowStockAlert: z.boolean(),
      lowStockThreshold: optNum(z.number().int().min(1)),
      moq: z.number({ error: 'Minimum is 1' }).int().min(1),
      maxOrderQty: optNum(z.number().int().min(1)),
      unit: z.string(),
    }),
    variantOptions: z.array(z.object({ name: required('Option name', 40), values: z.array(z.string()).min(1, 'Add at least one value').max(20) })).max(3),
    variants: z
      .array(
        z.object({
          _id: z.string().optional(),
          options: z.array(z.string()),
          price: z.number({ error: 'Enter a price' }).int().min(1, 'Enter a price'),
          mrp: z.number({ error: 'Enter the MRP' }).int().min(1, 'Enter the MRP'),
          sku: z.string().trim().max(64).optional(),
          barcode,
          stock: optNum(z.number().int().min(0)),
          available: z.boolean(),
          weightKg: optNum(z.number().min(0)),
          image: z.any().optional(),
        }),
      )
      .max(100),
    bulkPricing: z.object({
      tiers: z
        .array(
          z.object({
            minQty: z.number({ error: 'Enter a quantity' }).int().min(2, 'At least 2'),
            price: z.number({ error: 'Enter a price' }).int().min(1, 'Enter a price'),
          }),
        )
        .max(MAX_TIERS),
      businessOnly: z.boolean(),
    }),
    quotes: z.object({ enabled: z.boolean(), minQty: optNum(z.number().int().min(1)) }),
    condition: z.enum(['new', 'refurbished', 'used']),
    warranty: z.object({ months: optNum(z.number().int().min(0).max(240)), details: z.string().trim().max(500).optional() }),
    shipping: z.object({
      weightKg: optNum(z.number().min(0).max(100_000)),
      lengthCm: optNum(z.number().min(0).max(10_000)),
      widthCm: optNum(z.number().min(0).max(10_000)),
      heightCm: optNum(z.number().min(0).max(10_000)),
      dispatchDays: optNum(z.number().int().min(0).max(60)),
    }),
    specifications: z.array(z.object({ label: required('Label', 80), value: required('Value', 300) })).max(50),
    compatibleWith: z.array(z.object({ _id: z.string(), name: z.string() }).loose()).max(100),
    compatibleModels: z.array(z.string()).max(100),
    tags: z.array(z.string()).max(20),
  })
  .superRefine((v, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message })
    if (v.variants.length) {
      v.variants.forEach((row, i) => row.price > row.mrp && issue(['variants', i, 'price'], 'More than MRP'))
      return
    }
    if (!v.pricing.mrp) issue(['pricing', 'mrp'], 'Enter the MRP')
    if (!v.pricing.price) issue(['pricing', 'price'], 'Enter the selling price')
    if (v.pricing.price > v.pricing.mrp) issue(['pricing', 'price'], 'Selling price cannot be more than MRP')
    if (v.inventory.trackQuantity && v.inventory.stock === undefined) issue(['inventory', 'stock'], 'Enter the quantity you have')
  })
  .refine((v) => !v.inventory.maxOrderQty || v.inventory.maxOrderQty >= v.inventory.moq, {
    path: ['inventory', 'maxOrderQty'],
    message: 'Must be at least the minimum order',
  })
  .superRefine((v, ctx) => {
    if (v.variants.length) return
    for (const issue of bulkTierIssues(v.bulkPricing.tiers, { basePrice: v.pricing.price, moq: v.inventory.moq })) {
      ctx.addIssue({ code: 'custom', path: ['bulkPricing', 'tiers', issue.index, issue.field], message: issue.message })
    }
  })

const EMPTY = {
  type: 'tool',
  name: '',
  category: '',
  brand: '',
  modelNumber: '',
  sku: '',
  barcode: '',
  shortDescription: '',
  description: '',
  images: [],
  pricing: { mrp: undefined, price: undefined, gstRate: 18 },
  hsnCode: '',
  inventory: {
    trackQuantity: true,
    available: true,
    stock: undefined,
    lowStockAlert: false,
    lowStockThreshold: 5,
    moq: 1,
    maxOrderQty: undefined,
    unit: 'piece',
  },
  variantOptions: [],
  variants: [],
  bulkPricing: { tiers: [], businessOnly: false },
  quotes: { enabled: true, minQty: undefined },
  condition: 'new',
  warranty: { months: undefined, details: '' },
  shipping: { weightKg: undefined, lengthCm: undefined, widthCm: undefined, heightCm: undefined, dispatchDays: 2 },
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
    barcode: p.barcode ?? '',
    shortDescription: p.shortDescription ?? '',
    description: p.description ?? '',
    images: p.images,
    pricing: { mrp: p.pricing.mrp, price: p.pricing.price, gstRate: p.pricing.gstRate },
    hsnCode: p.hsnCode ?? '',
    inventory: {
      trackQuantity: p.inventory.trackQuantity !== false,
      available: p.inventory.available !== false,
      stock: p.inventory.stock,
      lowStockAlert: Boolean(p.inventory.lowStockAlert),
      lowStockThreshold: p.inventory.lowStockThreshold ?? 5,
      moq: p.inventory.moq,
      maxOrderQty: p.inventory.maxOrderQty ?? undefined,
      unit: p.inventory.unit,
    },
    variantOptions: p.variantOptions ?? [],
    variants: (p.variants ?? []).map((v) => ({
      _id: v._id,
      options: v.options,
      price: v.price,
      mrp: v.mrp,
      sku: v.sku ?? '',
      barcode: v.barcode ?? '',
      stock: v.stock,
      available: v.available !== false,
      weightKg: v.weightKg ?? undefined,
      image: v.image ?? undefined,
    })),
    bulkPricing: { tiers: (p.bulkPricing?.tiers ?? []).map(({ minQty, price }) => ({ minQty, price })), businessOnly: Boolean(p.bulkPricing?.businessOnly) },
    quotes: { enabled: p.quotes?.enabled ?? true, minQty: p.quotes?.minQty ?? undefined },
    condition: p.condition,
    warranty: { months: p.warranty?.months ?? undefined, details: p.warranty?.details ?? '' },
    shipping: {
      weightKg: p.shipping?.weightKg ?? undefined,
      lengthCm: p.shipping?.lengthCm ?? undefined,
      widthCm: p.shipping?.widthCm ?? undefined,
      heightCm: p.shipping?.heightCm ?? undefined,
      dispatchDays: p.shipping?.dispatchDays ?? undefined,
    },
    specifications: p.specifications,
    compatibleWith: p.compatibleWith,
    compatibleModels: p.compatibleModels,
    tags: p.tags,
  }
}

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''))

function toPayload(v) {
  const isPart = v.type === 'part'
  const hasVariants = v.variants.length > 0
  // With variants the listing price is the cheapest variant (the server derives it too).
  const cheapest = hasVariants ? [...v.variants].sort((a, b) => a.price - b.price)[0] : null
  return {
    type: v.type,
    name: v.name,
    category: v.category,
    brand: v.brand,
    modelNumber: v.modelNumber,
    sku: v.sku,
    barcode: v.barcode,
    shortDescription: v.shortDescription,
    description: v.description,
    images: v.images.map(({ media, alt }) => clean({ media, alt })),
    pricing: hasVariants ? { mrp: cheapest.mrp, price: cheapest.price, gstRate: v.pricing.gstRate } : v.pricing,
    hsnCode: v.hsnCode,
    inventory: clean({ ...v.inventory, stock: hasVariants || !v.inventory.trackQuantity ? 0 : v.inventory.stock }),
    variantOptions: hasVariants ? v.variantOptions : [],
    variants: v.variants.map(({ image, ...row }) =>
      clean({ ...row, stock: v.inventory.trackQuantity ? (row.stock ?? 0) : 0, ...(image?.media ? { image: { media: image.media } } : {}) }),
    ),
    bulkPricing: hasVariants ? { tiers: [], businessOnly: false } : v.bulkPricing,
    quotes: hasVariants ? { enabled: false } : clean(v.quotes),
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
  const unit = useWatch({ control, name: 'inventory.unit' })
  const tracked = useWatch({ control, name: 'inventory.trackQuantity' })
  const lowStockAlert = useWatch({ control, name: 'inventory.lowStockAlert' })
  const variantCount = useWatch({ control, name: 'variants' })?.length ?? 0

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

          <VariantsCard control={control} register={register} setValue={setValue} errors={e} tracked={tracked} />

          {variantCount === 0 && <BulkPricingCard control={control} register={register} errors={e} unit={unit} />}

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
              {variantCount > 0 ? (
                <p className="text-sm text-slate-600">Each variant has its own price. Buyers see “from” the cheapest one.</p>
              ) : (
                <>
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
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="GST" />
            <CardBody className="flex flex-col gap-4">
              <Field label="HSN/SAC code" required error={e.hsnCode?.message} hint="4, 6 or 8 digits. SAC codes (services) start with 99.">
                {(p) => <Input {...p} inputMode="numeric" maxLength={8} {...register('hsnCode')} />}
              </Field>
              <Field label="GST rate (%)" required error={e.pricing?.gstRate?.message}>
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
              {variantCount === 0 && pricing?.price > 0 && (
                <p className="text-xs text-slate-500">
                  GST included in the price: {formatINR(Math.round(pricing.price - pricing.price / (1 + Number(pricing.gstRate) / 100)))}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Inventory" />
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="SKU (Stock Keeping Unit)" error={e.sku?.message} hint="Leave empty to auto-generate" className="col-span-2">
                {(p) => <Input {...p} placeholder={product?.sku ?? 'Auto-generated'} {...register('sku')} />}
              </Field>
              <Field label="Barcode (ISBN, UPC, GTIN, etc.)" error={e.barcode?.message} className="col-span-2">
                {(p) => <Input {...p} inputMode="numeric" maxLength={14} {...register('barcode')} />}
              </Field>
              <div className="col-span-2 border-t border-slate-100 pt-4">
                <Controller
                  name="inventory.trackQuantity"
                  control={control}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      label="Track quantity"
                      description={
                        field.value ? 'Stock goes down with every order.' : 'No count is kept. Use the Available switch in your product list to stop sales.'
                      }
                    />
                  )}
                />
              </div>
              {tracked && variantCount === 0 && (
                <Field label="Quantity" required error={e.inventory?.stock?.message} className="col-span-2">
                  {(p) => (
                    <Controller
                      name="inventory.stock"
                      control={control}
                      render={({ field }) => <NumberInput {...p} value={field.value} onChange={field.onChange} />}
                    />
                  )}
                </Field>
              )}
              {tracked && variantCount > 0 && <p className="col-span-2 text-sm text-slate-600">Set the quantity for each variant in the Variants table.</p>}
              {tracked && (
                <div className="col-span-2 flex flex-col gap-3">
                  <Checkbox
                    label="Low stock alert"
                    description="Show an alert to the customer when a few units are left"
                    {...register('inventory.lowStockAlert')}
                  />
                  {lowStockAlert && (
                    <Field label="Alert at or below" error={e.inventory?.lowStockThreshold?.message} className="w-40">
                      {(p) => (
                        <Controller
                          name="inventory.lowStockThreshold"
                          control={control}
                          render={({ field }) => <NumberInput {...p} min={1} value={field.value} onChange={field.onChange} suffix="units" />}
                        />
                      )}
                    </Field>
                  )}
                </div>
              )}
              <Field label="Unit" className="border-t border-slate-100 pt-4">
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
              <Field label="Min. order" error={e.inventory?.moq?.message} className="border-t border-slate-100 pt-4">
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
            <CardHeader
              title="Shipping & warranty"
              description="Packed size and weight, as the courier will collect it. Used to book shipments and price delivery."
            />
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Package weight" error={e.shipping?.weightKg?.message} hint={variantCount > 0 ? 'Variants can set their own weight' : undefined}>
                {(p) => (
                  <Controller
                    name="shipping.weightKg"
                    control={control}
                    render={({ field }) => (
                      <NumberInput {...p} step="0.01" inputMode="decimal" value={field.value} onChange={field.onChange} suffix="kg" placeholder="0.00" />
                    )}
                  />
                )}
              </Field>
              <Field label="Dispatch in" error={e.shipping?.dispatchDays?.message}>
                {(p) => (
                  <Controller
                    name="shipping.dispatchDays"
                    control={control}
                    render={({ field }) => <NumberInput {...p} value={field.value} onChange={field.onChange} suffix="days" />}
                  />
                )}
              </Field>
              <fieldset className="col-span-2 flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-semibold text-slate-900">Package size (L × W × H)</legend>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['lengthCm', 'Length'],
                    ['widthCm', 'Width'],
                    ['heightCm', 'Height'],
                  ].map(([key, label]) => (
                    <Controller
                      key={key}
                      name={`shipping.${key}`}
                      control={control}
                      render={({ field }) => (
                        <NumberInput
                          aria-label={`${label} in centimetres`}
                          aria-invalid={Boolean(e.shipping?.[key]) || undefined}
                          step="0.1"
                          inputMode="decimal"
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={label}
                          suffix="cm"
                        />
                      )}
                    />
                  ))}
                </div>
                <p className="text-xs text-slate-500">Measure the box it ships in. Leave empty to use the store’s default package size.</p>
              </fieldset>
              <div className="col-span-2 border-t border-slate-100" />
              <Field label="Warranty" error={e.warranty?.months?.message}>
                {(p) => (
                  <Controller
                    name="warranty.months"
                    control={control}
                    render={({ field }) => <NumberInput {...p} value={field.value} onChange={field.onChange} suffix="months" />}
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
