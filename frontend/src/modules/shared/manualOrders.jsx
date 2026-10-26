import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, Copy, Link2, PackagePlus, Plus, ReceiptText, Search, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { publicApi } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { useDebounce } from '@/core/hooks/useDebounce'
import { cn } from '@/core/lib/cn'
import { INDIAN_STATES } from '@/core/lib/constants'
import { formatDateTime, formatINR, formatPhone } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { SegmentedControl } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { PhoneInput, PriceInput, QuantityStepper } from '@/ui/inputs'
import { ShareButton } from './share'
import { WhatsAppButton, whatsappLink } from './whatsapp'

/**
 * Orders entered from a panel. `client` is the panel's side of /manual-orders:
 *   { root: queryKey prefix, products(params), lookupCustomer(phone), create(body), links(params), cancelLink(id) }
 * Admins pick from every seller's products; sellers (and the house store) from their own.
 */
export function manualOrderClient(http, productsPath = '/products') {
  const one = (p) => p.then((r) => r.data.data)
  return {
    products: (params) => http.get(productsPath, { params }).then((r) => r.data.data),
    lookupCustomer: (phone) => one(http.get('/manual-orders/customer', { params: { phone } })),
    create: (body) => one(http.post('/manual-orders', body)),
    links: (params) => http.get('/manual-orders/links', { params }).then((r) => ({ items: r.data.data, meta: r.data.meta })),
    cancelLink: (id) => one(http.post(`/manual-orders/links/${id}/cancel`)),
  }
}

const variantLabel = (v) => v.options?.join(' / ') ?? ''
const emptyAddress = { line1: '', line2: '', landmark: '', city: '', state: '', pincode: '' }

const LINK_STATUS = { open: 'Awaiting payment', paid: 'Paid', cancelled: 'Cancelled', expired: 'Expired' }
const LINK_TONE = { open: 'info', paid: 'success', cancelled: 'neutral', expired: 'warning' }

/** The message sent with a payment link. */
const linkMessage = (link, siteName) =>
  `Hi ${link.customer?.name ?? ''}, here is your order${siteName ? ` from ${siteName}` : ''} for ${formatINR(link.amounts.total)}. Pay securely here: ${link.url}`

/**
 * "Create order" button with its two choices: place the order now, or share a payment link.
 * `onCreated(order)` runs after a direct order (e.g. to open it).
 */
export function CreateOrderButton({ client, root, onCreated, siteName }) {
  const [mode, setMode] = useState(null)
  const [choosing, setChoosing] = useState(false)
  const [shared, setShared] = useState(null)
  return (
    <>
      <Button onClick={() => setChoosing(true)}>
        <PackagePlus /> Create order
      </Button>
      <Dialog open={choosing} onOpenChange={setChoosing} title="Create an order" description="Place it yourself, or send the customer a link to pay." size="md">
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={ReceiptText}
            title="Create"
            text="Place the order now. Collect cash on delivery, or mark it already paid."
            onClick={() => {
              setChoosing(false)
              setMode('create')
            }}
          />
          <ChoiceCard
            icon={Link2}
            title="Share"
            text="Get a payment link for WhatsApp or anywhere else. The order is placed when they pay online."
            onClick={() => {
              setChoosing(false)
              setMode('share')
            }}
          />
        </div>
      </Dialog>
      <ManualOrderDialog
        open={Boolean(mode)}
        mode={mode ?? 'create'}
        onOpenChange={(open) => !open && setMode(null)}
        client={client}
        root={root}
        onDone={(result) => {
          setMode(null)
          if (result.link) setShared(result.link)
          else onCreated?.(result.order)
        }}
      />
      <LinkReadyDialog link={shared} onOpenChange={(open) => !open && setShared(null)} siteName={siteName} />
    </>
  )
}

function ChoiceCard({ icon: Icon, title, text, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-lg border border-slate-300 p-4 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-5" />
      </span>
      <span className="font-display text-base font-bold text-slate-900">{title}</span>
      <span className="text-sm text-slate-600">{text}</span>
    </button>
  )
}

/** Mounted only while open, so every order starts from a blank form. */
function ManualOrderDialog({ open, ...props }) {
  return open ? <ManualOrderForm {...props} /> : null
}

function ManualOrderForm({ mode, onOpenChange, client, root, onDone }) {
  const open = true
  const qc = useQueryClient()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState(emptyAddress)
  const [items, setItems] = useState([])
  const [discount, setDiscount] = useState()
  const [deliveryFee, setDeliveryFee] = useState()
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cod')
  const [validDays, setValidDays] = useState(7)
  const [errors, setErrors] = useState({})

  const validPhone = /^[6-9]\d{9}$/.test(phone)
  const customer = useQuery({
    queryKey: [...root, 'manual-customer', phone],
    queryFn: () => client.lookupCustomer(phone),
    enabled: open && validPhone,
    staleTime: 60_000,
  })
  const found = customer.data?.found ? customer.data : null

  // City and state from the pincode, unless typed already.
  useEffect(() => {
    if (!/^[1-9]\d{5}$/.test(address.pincode)) return
    const controller = new AbortController()
    publicApi
      .get(`/public/pincodes/${address.pincode}`, { signal: controller.signal })
      .then((r) => {
        const { city, state } = r.data.data
        const match = INDIAN_STATES.find((s) => s.toLowerCase().replace(/[^a-z]/g, '') === String(state).toLowerCase().replace('&', 'and').replace(/[^a-z]/g, ''))
        setAddress((a) => ({ ...a, city: a.city || city, state: a.state || match || '' }))
      })
      .catch(() => {})
    return () => controller.abort()
  }, [address.pincode])

  const subtotal = items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.quantity, 0)
  const total = Math.max(0, subtotal - (discount ?? 0)) + (deliveryFee ?? 0)

  const submit = useMutation({
    mutationFn: () =>
      client.create({
        mode,
        customer: found ? { userId: found._id } : { phone, name: name.trim() },
        address: { ...address, name: name.trim() || undefined, phone },
        items: items.map((i) => ({ product: i.product._id, variant: i.variant?._id, quantity: i.quantity, unitPrice: i.unitPrice })),
        discount: discount ?? 0,
        deliveryFee: deliveryFee ?? 0,
        notes: notes.trim() || undefined,
        ...(mode === 'create' ? { paymentMethod } : { validDays }),
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: root })
      toast.success(result.link ? 'Payment link ready' : `Order ${result.order.orderNumber} placed`)
      onDone(result)
    },
    onError: (err) => {
      const fieldErrors = {}
      for (const d of err.response?.data?.error?.details ?? []) if (d.path) fieldErrors[String(d.path).split('.')[0]] = d.message
      setErrors(fieldErrors)
      toast.error(errorMessage(err))
    },
  })

  const check = () => {
    const e = {}
    if (!validPhone) e.phone = 'Enter a 10 digit mobile number'
    if (!found && !name.trim()) e.name = 'Enter the customer’s name'
    if (!address.line1.trim()) e.line1 = 'Required'
    if (!address.city.trim()) e.city = 'Required'
    if (!address.state) e.state = 'Required'
    if (!/^[1-9]\d{5}$/.test(address.pincode)) e.pincode = 'Enter a 6 digit pincode'
    if (!items.length) e.items = 'Add at least one product'
    if (items.some((i) => i.product.variants?.length && !i.variant)) e.items = 'Choose an option for each product'
    if ((discount ?? 0) > subtotal) e.discount = 'More than the order value'
    setErrors(e)
    if (!Object.keys(e).length) submit.mutate()
  }

  const setAddr = (field) => (e) => setAddress((a) => ({ ...a, [field]: e.target.value }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={mode === 'share' ? 'Share a payment link' : 'Create an order'}
      description={
        mode === 'share'
          ? 'The customer opens the link and pays online; no sign-in needed. Stock is taken when they pay.'
          : 'The order is placed straight away and stock is reserved.'
      }
      footer={
        <>
          <span className="mr-auto self-center text-sm text-slate-600">
            Total <span className="tabular font-bold text-slate-900">{formatINR(total)}</span>
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={submit.isPending} onClick={check}>
            {mode === 'share' ? (
              <>
                <Link2 /> Create link
              </>
            ) : (
              <>
                <Check /> Place order
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-sm font-bold tracking-wide text-slate-500 uppercase">Products</h3>
            <ProductPicker client={client} root={root} onPick={(product) => setItems((list) => addItem(list, product))} />
            {errors.items && <p className="text-xs font-medium text-red-600">{errors.items}</p>}
            {items.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {items.map((item, k) => (
                  <ItemRow
                    key={item.key}
                    item={item}
                    onChange={(patch) => setItems((list) => list.map((i, j) => (j === k ? { ...i, ...patch } : i)))}
                    onRemove={() => setItems((list) => list.filter((_, j) => j !== k))}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-bold tracking-wide text-slate-500 uppercase">Customer</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Mobile number"
                required
                error={errors.phone}
                hint={validPhone ? (customer.isFetching ? 'Looking up…' : found ? `Existing customer: ${found.name}` : 'New customer: an account is opened for this number') : undefined}
              >
                {(p) => <PhoneInput {...p} value={phone} onChange={setPhone} />}
              </Field>
              <Field label="Name" required={!found} error={errors.name}>
                {(p) => <Input {...p} value={name} placeholder={found?.name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-11" />}
              </Field>
            </div>
            {found?.addresses?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {found.addresses.map((a, k) => (
                  <Button key={k} type="button" variant="outline" size="sm" onClick={() => setAddress({ ...emptyAddress, ...a })}>
                    Use {a.line1}, {a.city}
                  </Button>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address" required error={errors.line1} className="sm:col-span-2">
                {(p) => <Input {...p} value={address.line1} onChange={setAddr('line1')} placeholder="House / shop, street" maxLength={200} />}
              </Field>
              <Field label="Area / locality">{(p) => <Input {...p} value={address.line2} onChange={setAddr('line2')} maxLength={200} />}</Field>
              <Field label="Landmark">{(p) => <Input {...p} value={address.landmark} onChange={setAddr('landmark')} maxLength={120} />}</Field>
              <Field label="Pincode" required error={errors.pincode}>
                {(p) => (
                  <Input {...p} value={address.pincode} inputMode="numeric" maxLength={6} onChange={(e) => setAddress((a) => ({ ...a, pincode: e.target.value.replace(/\D/g, '') }))} />
                )}
              </Field>
              <Field label="City" required error={errors.city}>
                {(p) => <Input {...p} value={address.city} onChange={setAddr('city')} maxLength={80} />}
              </Field>
              <Field label="State" required error={errors.state} className="sm:col-span-2">
                {(p) => (
                  <Select {...p} value={address.state} onChange={setAddr('state')} placeholder="Choose a state">
                    {INDIAN_STATES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </section>
        </div>

        <aside className="space-y-4 rounded-lg bg-slate-50 p-4 lg:self-start">
          <Field label="Discount" error={errors.discount} hint="Spread over the items, like a coupon.">
            {(p) => <PriceInput {...p} value={discount} onChange={setDiscount} />}
          </Field>
          <Field label="Delivery fee">{(p) => <PriceInput {...p} value={deliveryFee} onChange={setDeliveryFee} />}</Field>
          {mode === 'create' ? (
            <Field label="Payment">
              {() => (
                <SegmentedControl
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  size="sm"
                  options={[
                    { value: 'cod', label: 'Cash on delivery' },
                    { value: 'offline', label: 'Already paid' },
                  ]}
                />
              )}
            </Field>
          ) : (
            <Field label="Link valid for" hint="After this the link stops working.">
              {(p) => (
                <Select {...p} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))}>
                  {[1, 3, 7, 15, 30].map((d) => (
                    <option key={d} value={d}>
                      {d} day{d === 1 ? '' : 's'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <Field label="Note" hint="Shown on the order.">
            {(p) => <Textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />}
          </Field>
          <dl className="space-y-1.5 border-t border-slate-200 pt-3 text-sm">
            <Row label="Items" value={formatINR(subtotal)} />
            {discount > 0 && <Row label="Discount" value={`− ${formatINR(discount)}`} />}
            <Row label="Delivery" value={deliveryFee ? formatINR(deliveryFee) : 'Free'} />
            <Row label="Total" value={formatINR(total)} strong />
          </dl>
        </aside>
      </div>
    </Dialog>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'border-t border-slate-200 pt-1.5 font-bold text-slate-900')}>
      <dt className={strong ? undefined : 'text-slate-600'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  )
}

let nextKey = 0
function addItem(list, product) {
  // A simple product already on the order just gets one more; variant products get a row per option.
  const existing = !product.variants?.length && list.findIndex((i) => i.product._id === product._id)
  if (existing !== false && existing >= 0) return list.map((i, k) => (k === existing ? { ...i, quantity: i.quantity + 1 } : i))
  nextKey += 1
  return [...list, { key: nextKey, product, variant: null, quantity: product.inventory?.moq ?? 1, unitPrice: product.variants?.length ? undefined : product.pricing.price }]
}

function ItemRow({ item, onChange, onRemove }) {
  const { product } = item
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <Thumb src={item.variant?.image?.url ?? product.images?.[0]?.url} className="size-11 shrink-0 rounded border border-slate-200" />
      <div className="min-w-40 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-slate-900">{product.name}</p>
        {product.vendor?.store?.name && <p className="text-xs text-slate-500">{product.vendor.store.name}</p>}
        {product.variants?.length > 0 && (
          <Select
            aria-label="Option"
            className="mt-1 h-8 text-xs"
            value={item.variant?._id ?? ''}
            placeholder="Choose an option"
            onChange={(e) => {
              const variant = product.variants.find((v) => v._id === e.target.value) ?? null
              onChange({ variant, unitPrice: variant?.price })
            }}
          >
            {product.variants.map((v) => (
              <option key={v._id} value={v._id}>
                {variantLabel(v)} · {formatINR(v.price)}
              </option>
            ))}
          </Select>
        )}
      </div>
      <QuantityStepper size="sm" value={item.quantity} onChange={(quantity) => onChange({ quantity })} />
      <div className="w-28">
        <PriceInput aria-label="Unit price" value={item.unitPrice} onChange={(unitPrice) => onChange({ unitPrice })} className="h-8" />
      </div>
      <span className="tabular w-24 text-right text-sm font-semibold">{formatINR((item.unitPrice ?? 0) * item.quantity)}</span>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${product.name}`} onClick={onRemove}>
        <Trash2 />
      </Button>
    </li>
  )
}

function ProductPicker({ client, root, onPick }) {
  const [q, setQ] = useState('')
  const term = useDebounce(q.trim(), 300)
  const { data, isFetching } = useQuery({
    queryKey: [...root, 'manual-products', term],
    queryFn: () => client.products({ q: term || undefined, status: 'active', limit: 8 }),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
  })
  const results = term.length >= 2 ? (data ?? []) : []
  return (
    <div className="relative">
      <Input prefix={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search live products by name or SKU" aria-label="Search products" />
      {results.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.map((p) => (
            <li key={p._id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  onPick(p)
                  setQ('')
                }}
              >
                <Thumb src={p.images?.[0]?.url} className="size-9 shrink-0 rounded border border-slate-200" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{p.name}</span>
                  <span className="block text-xs text-slate-500">
                    {[p.sku, p.vendor?.store?.name, p.variants?.length ? `${p.variants.length} options` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="tabular text-sm font-semibold">{formatINR(p.pricing.price)}</span>
                <Plus className="size-4 text-primary" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {term.length >= 2 && !isFetching && data && !data.length && <p className="mt-1 text-xs text-slate-500">No live products match “{term}”.</p>}
    </div>
  )
}

/** Shown once a link is made: copy it, or send it straight to the customer's WhatsApp. */
function LinkReadyDialog({ link, onOpenChange, siteName }) {
  return (
    <Dialog open={Boolean(link)} onOpenChange={onOpenChange} size="sm" title="Payment link ready" description={link ? `${formatINR(link.amounts.total)} for ${link.customer?.name ?? 'the customer'}` : undefined}>
      {link && <LinkActions link={link} siteName={siteName} />}
    </Dialog>
  )
}

function LinkActions({ link, siteName }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the link and copy it.')
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input readOnly value={link.url} aria-label="Payment link" onFocus={(e) => e.target.select()} className="code h-10 min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 px-3 text-xs" />
        <Button variant={copied ? 'soft' : 'outline'} onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {link.customer?.phone && (
          <Button asChild className="bg-[#25d366] text-white hover:bg-[#1ebe5a]">
            <a href={whatsappLink(link.customer.phone, linkMessage(link, siteName))} target="_blank" rel="noopener noreferrer">
              Send on WhatsApp
            </a>
          </Button>
        )}
        <ShareButton item={{ title: `Order for ${formatINR(link.amounts.total)}`, url: link.url, text: linkMessage(link, siteName) }} label="Other apps" />
      </div>
    </div>
  )
}

/** Every payment link this panel made, with their state. */
export function PaymentLinksButton({ client, root, siteName }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Link2 /> Payment links
      </Button>
      <Dialog open={open} onOpenChange={setOpen} size="xl" title="Payment links" description="Orders shared with customers to pay online.">
        {open && <PaymentLinks client={client} root={root} siteName={siteName} />}
      </Dialog>
    </>
  )
}

function PaymentLinks({ client, root, siteName }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const params = { page, limit: 10, status: status || undefined }
  const { data, isLoading } = useQuery({ queryKey: [...root, 'manual-links', params], queryFn: () => client.links(params), placeholderData: keepPreviousData })
  const cancel = useMutation({
    mutationFn: client.cancelLink,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...root, 'manual-links'] })
      toast.success('Link cancelled')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <div className="space-y-3">
      <SegmentedControl
        size="sm"
        value={status}
        onChange={(s) => {
          setStatus(s)
          setPage(1)
        }}
        options={[{ value: '', label: 'All' }, ...Object.entries(LINK_STATUS).map(([value, label]) => ({ value, label }))]}
      />
      <DataTable
        loading={isLoading}
        rows={data?.items}
        empty={{ title: 'No payment links yet' }}
        columns={[
          {
            key: 'customer',
            header: 'Customer',
            cell: (l) => (
              <div>
                <p className="text-slate-800">{l.customer?.name}</p>
                <p className="text-xs text-slate-500">{formatPhone(l.customer?.phone)}</p>
              </div>
            ),
          },
          { key: 'items', header: 'Items', cell: (l) => <span className="line-clamp-2 text-xs">{l.items.map((i) => `${i.quantity} × ${i.name}`).join(', ')}</span> },
          { key: 'total', header: 'Total', className: 'text-right', cell: (l) => <span className="tabular font-semibold">{formatINR(l.amounts.total)}</span> },
          {
            key: 'status',
            header: 'Status',
            cell: (l) => (
              <div className="space-y-0.5">
                <Badge tone={LINK_TONE[l.status]}>{LINK_STATUS[l.status]}</Badge>
                <p className="text-xs text-slate-500">{l.order ? l.order.orderNumber : `Until ${formatDateTime(l.expiresAt)}`}</p>
              </div>
            ),
          },
          {
            key: 'actions',
            header: '',
            className: 'w-px whitespace-nowrap',
            cell: (l) =>
              l.status === 'open' ? (
                <div className="flex items-center gap-1">
                  <WhatsAppButton phone={l.customer?.phone} text={linkMessage(l, siteName)} title="Send on WhatsApp" />
                  <ShareButton item={{ title: `Order for ${formatINR(l.amounts.total)}`, url: l.url, text: linkMessage(l, siteName) }} iconOnly variant="ghost" />
                  <Button variant="ghost" size="icon-sm" aria-label="Cancel link" title="Cancel link" onClick={() => window.confirm('Cancel this payment link?') && cancel.mutate(l._id)}>
                    <Ban />
                  </Button>
                </div>
              ) : l.order ? (
                <StatusBadge status={l.order.status} />
              ) : null,
          },
        ]}
      />
      <Pagination meta={data?.meta} onPageChange={setPage} />
    </div>
  )
}
