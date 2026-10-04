import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, CloudUpload, CreditCard, HardDrive, Palette, ShieldCheck, Store, Truck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { publicSettingsKey } from '@/core/settings/usePublicSettings'
import { contrastRatio, DEFAULT_THEMES, RADIUS_PX, readableOn } from '@/core/theme/theme'
import { cn } from '@/core/lib/cn'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { SegmentedControl, Switch, Tabs } from '@/ui/Controls'
import { Field, Input } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { ColorInput, PriceInput } from '@/ui/inputs'
import { PageHeader } from '@/ui/PageHeader'
import { adminApi, adminKeys } from '../api'

function useSaveSettings(key, message = 'Settings saved') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body) => adminApi.updateSettings(key, body),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data)
      qc.invalidateQueries({ queryKey: publicSettingsKey })
      toast.success(message)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
}

export default function SettingsPage() {
  const { data, isLoading } = useQuery({ queryKey: adminKeys.settings, queryFn: adminApi.settings })

  return (
    <>
      <PageHeader title="Settings" description="Control how the marketplace looks and which services it uses." />
      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <Tabs
          tabs={[
            { value: 'appearance', label: 'Appearance', icon: Palette, content: <AppearanceSettings theme={data.theme} /> },
            { value: 'branding', label: 'Branding', icon: Store, content: <BrandingSettings branding={data.branding} theme={data.theme} /> },
            { value: 'storage', label: 'Storage', icon: HardDrive, content: <StorageSettings storage={data.storage} integrations={data.integrations} /> },
            { value: 'payments', label: 'Payments', icon: CreditCard, content: <PaymentSettings payments={data.payments} integrations={data.integrations} /> },
            { value: 'shipping', label: 'Shipping', icon: Truck, content: <ShippingSettings shipping={data.shipping} /> },
            { value: 'moderation', label: 'Moderation', icon: ShieldCheck, content: <ModerationSettings moderation={data.moderation} /> },
          ]}
        />
      )}
    </>
  )
}

/* ───────────────────────── Appearance ───────────────────────── */

const MODULES = [
  { value: 'user', label: 'Storefront' },
  { value: 'vendor', label: 'Vendor panel' },
  { value: 'admin', label: 'Admin panel' },
]

const PRESETS = [
  { name: 'ToolsHubs Green', primary: '#15803d', secondary: '#0f291e', accent: '#f59e0b' },
  { name: 'Industrial orange', primary: '#e8590c', secondary: '#1b2a41', accent: '#0f9d58' },
  { name: 'Steel blue', primary: '#2563eb', secondary: '#0f172a', accent: '#f59e0b' },
  { name: 'Indigo', primary: '#4f46e5', secondary: '#111827', accent: '#10b981' },
  { name: 'Agri green', primary: '#15803d', secondary: '#1c2a1e', accent: '#ca8a04' },
  { name: 'Crimson', primary: '#be123c', secondary: '#1f1d2b', accent: '#0891b2' },
  { name: 'Teal', primary: '#0f766e', secondary: '#13293d', accent: '#ea580c' },
]

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary', hint: 'Buttons, links, active states' },
  { key: 'secondary', label: 'Secondary', hint: 'Header, footer & sidebar background' },
  { key: 'accent', label: 'Accent', hint: 'Discounts, highlights, success' },
]

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v)

function AppearanceSettings({ theme }) {
  const [module, setModule] = useState('user')
  const [draft, setDraft] = useState(theme)
  const save = useSaveSettings('theme', 'Theme saved — it is live for everyone')
  const t = draft[module]
  const set = (patch) => setDraft((d) => ({ ...d, [module]: { ...d[module], ...patch } }))
  const valid = COLOR_FIELDS.every((f) => isHex(t[f.key]))
  const dirty = JSON.stringify(draft[module]) !== JSON.stringify(theme[module])

  const warnings = valid ? COLOR_FIELDS.map((f) => ({ ...f, ratio: contrastRatio(t[f.key], readableOn(t[f.key])) })).filter((f) => f.ratio < 4.5) : []

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader title="Theme colours" description="Each module has its own theme. Changes apply instantly for every visitor once saved." />
        <CardBody className="flex flex-col gap-6">
          <SegmentedControl value={module} onChange={setModule} options={MODULES} />

          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => set({ primary: p.primary, secondary: p.secondary, accent: p.accent })}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:border-slate-400',
                    t.primary === p.primary && t.secondary === p.secondary ? 'border-slate-900 bg-slate-50' : 'border-slate-200',
                  )}
                >
                  <span className="flex -space-x-1">
                    {[p.primary, p.secondary, p.accent].map((c) => (
                      <span key={c} className="size-4 rounded-full ring-2 ring-white" style={{ background: c }} />
                    ))}
                  </span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {COLOR_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint} error={!isHex(t[f.key]) ? 'Use #RRGGBB' : undefined}>
                {(p) => <ColorInput {...p} value={t[f.key]} onChange={(v) => set({ [f.key]: v.toLowerCase() })} />}
              </Field>
            ))}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">Corner radius</p>
            <SegmentedControl
              value={t.radius}
              onChange={(radius) => set({ radius })}
              options={Object.keys(RADIUS_PX).map((r) => ({ value: r, label: r === 'none' ? 'Square' : r.toUpperCase() }))}
            />
          </div>

          {warnings.length > 0 && (
            <Alert tone="warning" icon={AlertTriangle} title="Low contrast">
              {warnings.map((w) => `${w.label} (${w.ratio.toFixed(1)}:1)`).join(', ')} — text on these colours is below the 4.5:1 accessibility guideline. Try a
              darker shade.
            </Alert>
          )}

          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-5">
            <Button variant="ghost" onClick={() => set(DEFAULT_THEMES[module])}>
              Reset to default
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!dirty} onClick={() => setDraft(theme)}>
                Discard
              </Button>
              <Button disabled={!valid || !dirty} loading={save.isPending} onClick={() => save.mutate({ [module]: t })}>
                Save {MODULES.find((m) => m.value === module).label.toLowerCase()} theme
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      <ThemePreview theme={t} module={module} />
    </div>
  )
}

/** Renders sample UI with the draft theme, scoped via CSS variables so the real admin UI is untouched. */
function ThemePreview({ theme, module }) {
  if (![theme.primary, theme.secondary, theme.accent].every(isHex)) return null
  const vars = {
    '--tb-primary': theme.primary,
    '--tb-primary-fg': readableOn(theme.primary),
    '--tb-secondary': theme.secondary,
    '--tb-secondary-fg': readableOn(theme.secondary),
    '--tb-accent': theme.accent,
    '--tb-accent-fg': readableOn(theme.accent),
    '--tb-radius': `${RADIUS_PX[theme.radius]}px`,
  }
  return (
    <div className="xl:sticky xl:top-24 xl:self-start">
      <p className="mb-2 text-sm font-medium text-slate-700">Live preview</p>
      <div style={vars} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm">
        {module === 'user' ? (
          <div className="flex items-center justify-between bg-secondary px-4 py-3 text-secondary-fg">
            <span className="font-bold">Storefront</span>
            <span className="rounded-md bg-white/10 px-2 py-1 text-xs">Search tools…</span>
          </div>
        ) : (
          <div className="flex">
            <div className="flex w-28 flex-col gap-1 bg-secondary p-2">
              <span className="rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-fg">Dashboard</span>
              <span className="px-2 py-1.5 text-xs text-secondary-fg/75">Products</span>
              <span className="px-2 py-1.5 text-xs text-secondary-fg/75">Orders</span>
            </div>
            <div className="flex-1 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
              {module === 'vendor' ? 'Seller panel' : 'Admin panel'}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-4 p-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900">Bosch GSB 550 Impact Drill</p>
                <p className="mt-1 text-lg font-bold text-slate-900">
                  ₹3,499 <span className="text-sm font-normal text-slate-400 line-through">₹4,500</span>{' '}
                  <span className="text-sm font-semibold text-accent-ink">22% off</span>
                </p>
              </div>
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">New</span>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-fg hover:bg-primary-hover">
                Add to cart
              </button>
              <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800">
                Details
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium text-primary underline underline-offset-4">A text link</span>
            <span className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg">Accent</span>
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-fg">Secondary</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Branding ───────────────────────── */

const BRAND_MODULES = [
  { value: 'user', label: 'Storefront', hint: 'Header and footer of the shop' },
  { value: 'vendor', label: 'Seller panel', hint: 'Sidebar and sign-in pages for vendors' },
  { value: 'admin', label: 'Admin panel', hint: 'Sidebar and sign-in page for your team' },
]

const asList = (img) => (img ? [img] : [])
const asRef = (list) => (list[0] ? { media: list[0].media } : null)

function BrandingSettings({ branding, theme }) {
  const [v, setV] = useState(() => ({
    siteName: branding.siteName,
    tagline: branding.tagline,
    supportEmail: branding.supportEmail,
    supportPhone: branding.supportPhone,
    modules: Object.fromEntries(
      BRAND_MODULES.map((m) => [m.value, { logo: asList(branding.modules?.[m.value]?.logo), favicon: asList(branding.modules?.[m.value]?.favicon) }]),
    ),
  }))
  const save = useSaveSettings('branding', 'Branding saved')
  const setModule = (module, patch) => setV((cur) => ({ ...cur, modules: { ...cur.modules, [module]: { ...cur.modules[module], ...patch } } }))

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Card>
        <CardHeader title="Marketplace" description="Name and contacts shared by every module." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Marketplace name" required>
            {(p) => <Input {...p} value={v.siteName} maxLength={60} onChange={(e) => setV({ ...v, siteName: e.target.value })} />}
          </Field>
          <Field label="Tagline">{(p) => <Input {...p} value={v.tagline} maxLength={160} onChange={(e) => setV({ ...v, tagline: e.target.value })} />}</Field>
          <Field label="Support email">
            {(p) => <Input {...p} type="email" value={v.supportEmail} onChange={(e) => setV({ ...v, supportEmail: e.target.value })} />}
          </Field>
          <Field label="Support phone">
            {(p) => <Input {...p} value={v.supportPhone} maxLength={20} onChange={(e) => setV({ ...v, supportPhone: e.target.value })} />}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Logos & browser icons"
          description="Each module can have its own logo and tab icon. Design each logo for the background in its preview. Empty slots use the name with the default mark."
        />
        <div className="grid divide-y divide-slate-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {BRAND_MODULES.map((m) => {
            const brand = v.modules[m.value]
            const colors = theme?.[m.value]
            return (
              <div key={m.value} className="flex flex-col gap-4 p-5">
                <div>
                  <p className="font-semibold text-slate-900">{m.label}</p>
                  <p className="text-xs text-slate-500">{m.hint}</p>
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-800">Logo</p>
                  <ImageUploader
                    audience="admin"
                    folder="branding"
                    max={1}
                    aspect="aspect-[3/1]"
                    gridClassName="grid-cols-1"
                    value={brand.logo}
                    onChange={(logo) => setModule(m.value, { logo })}
                    compact
                    label="Upload logo"
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-sm font-medium text-slate-800">Browser tab icon</p>
                  <div className="w-24">
                    <ImageUploader
                      audience="admin"
                      folder="favicons"
                      max={1}
                      gridClassName="grid-cols-1"
                      value={brand.favicon}
                      onChange={(favicon) => setModule(m.value, { favicon })}
                      compact
                      label="Upload"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">Square image; it's fitted to 256×256.</p>
                </div>

                {/* Preview: how the logo sits on this module's header colour, and the tab icon. */}
                <div className="mt-auto overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-100 px-2 py-1.5">
                    <span className="flex max-w-full items-center gap-1.5 rounded-t-md bg-white px-2 py-1 text-[11px] text-slate-700 shadow-xs">
                      {brand.favicon[0] ? (
                        <img src={brand.favicon[0].url} alt="" className="size-3.5" />
                      ) : (
                        <img src="/toolboxlogo.jpeg" alt="" className="size-3.5 rounded-xs object-contain" />
                      )}
                      <span className="truncate">{v.siteName || 'ToolsHubs'}</span>
                    </span>
                  </div>
                  <div className="flex h-14 items-center px-4" style={{ background: m.value === 'user' ? '#ffffff' : (colors?.secondary ?? '#111827') }}>
                    {brand.logo[0] ? (
                      <img src={brand.logo[0].url} alt="" className="h-8 w-auto max-w-40 object-contain" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <img src="/toolboxlogo.jpeg" alt="" className="size-7 rounded-sm object-contain bg-white shadow-xs" />
                        <span className="text-sm font-bold" style={{ color: m.value === 'user' ? '#0f172a' : '#ffffff' }}>
                          {v.siteName || 'ToolsHubs'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          loading={save.isPending}
          disabled={!v.siteName.trim()}
          onClick={() =>
            save.mutate({
              siteName: v.siteName.trim(),
              tagline: v.tagline,
              supportEmail: v.supportEmail.trim(),
              supportPhone: v.supportPhone.trim(),
              modules: Object.fromEntries(Object.entries(v.modules).map(([module, b]) => [module, { logo: asRef(b.logo), favicon: asRef(b.favicon) }])),
            })
          }
        >
          Save branding
        </Button>
      </div>
    </div>
  )
}

/* ───────────────────────── Storage ───────────────────────── */

function IntegrationStatus({ ok, okText = 'Configured', missingText = 'Not configured' }) {
  return ok ? (
    <Badge tone="success">
      <CheckCircle2 className="size-3" /> {okText}
    </Badge>
  ) : (
    <Badge tone="warning">{missingText}</Badge>
  )
}

function StorageSettings({ storage, integrations }) {
  const save = useSaveSettings('storage', 'Storage provider updated')
  const configured = integrations.cloudinary.configured
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader
          title="Image storage"
          description="Every upload is checked, auto-rotated, resized to max 1600px, stripped of metadata and converted to WebP before storing."
        />
        <CardBody className="flex flex-col gap-5">
          <div className="flex items-start gap-4 rounded-lg border border-slate-200 p-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-600">
              <CloudUpload className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-slate-900">Cloudinary</p>
                <IntegrationStatus ok={configured} />
              </div>
              <div className="mt-2">
                <Switch
                  checked={storage.cloudinaryEnabled}
                  disabled={!configured || save.isPending}
                  onCheckedChange={(cloudinaryEnabled) => save.mutate({ cloudinaryEnabled })}
                  label={storage.cloudinaryEnabled ? 'New uploads go to Cloudinary' : 'Off — new uploads are stored locally'}
                  description={
                    configured
                      ? 'CDN delivery with global caching.'
                      : 'Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET on the server to enable.'
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex items-start gap-4 rounded-lg border border-slate-200 p-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
              <HardDrive className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900">Local storage {!storage.cloudinaryEnabled && <Badge tone="primary">Active</Badge>}</p>
              <p className="mt-1 text-sm text-slate-600">
                Files are written to <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{integrations.localStorage.directory}</code> and served at{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{integrations.localStorage.publicPath}</code> (by nginx in production).
              </p>
            </div>
          </div>
          <Alert tone="neutral">Switching only affects new uploads. Existing images stay where they are and keep working.</Alert>
        </CardBody>
      </Card>
    </div>
  )
}

/* ───────────────────────── Payments ───────────────────────── */

function PaymentSettings({ payments, integrations }) {
  const [codMax, setCodMax] = useState(payments.codMaxOrderValue || undefined)
  const save = useSaveSettings('payments', 'Payment settings saved')
  const rz = integrations.razorpay
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader title="Online payments" action={<IntegrationStatus ok={rz.configured} />} />
        <CardBody className="flex flex-col gap-4">
          <Switch
            checked={payments.razorpayEnabled}
            disabled={!rz.configured || save.isPending}
            onCheckedChange={(razorpayEnabled) => save.mutate({ razorpayEnabled })}
            label="Accept payments with Razorpay"
            description={rz.configured ? 'UPI, cards, net banking and wallets.' : 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server to enable.'}
          />
          {rz.configured && !rz.webhookConfigured && (
            <Alert tone="warning" icon={AlertTriangle} title="Webhook secret missing">
              Set RAZORPAY_WEBHOOK_SECRET and point a Razorpay webhook (payment.captured, payment.failed, order.paid) at <code>/api/v1/webhooks/razorpay</code>{' '}
              so payments confirm even if the customer closes the tab.
            </Alert>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Cash on delivery" />
        <CardBody className="flex flex-col gap-5">
          <Switch
            checked={payments.codEnabled}
            disabled={save.isPending}
            onCheckedChange={(codEnabled) => save.mutate({ codEnabled })}
            label="Offer cash on delivery"
          />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Maximum order value for COD" hint="Leave empty for no limit" className="w-64">
              {(p) => <PriceInput {...p} value={codMax} onChange={setCodMax} placeholder="No limit" />}
            </Field>
            <Button variant="outline" loading={save.isPending} onClick={() => save.mutate({ codMaxOrderValue: codMax ?? 0 })}>
              Save limit
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

/* ───────────────────────── Shipping ───────────────────────── */

function ShippingSettings({ shipping }) {
  const [v, setV] = useState({ flatFee: shipping.flatFee || undefined, freeAbove: shipping.freeAbove || undefined })
  const save = useSaveSettings('shipping', 'Shipping settings saved')
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Shipping charges" description="Applied once per order at checkout." />
      <CardBody className="grid gap-5 sm:grid-cols-2">
        <Field label="Flat shipping fee" hint="Leave empty for free shipping on every order">
          {(p) => <PriceInput {...p} value={v.flatFee} onChange={(flatFee) => setV({ ...v, flatFee })} placeholder="Free" />}
        </Field>
        <Field label="Free shipping on orders above" hint="Leave empty to always charge the fee">
          {(p) => <PriceInput {...p} value={v.freeAbove} onChange={(freeAbove) => setV({ ...v, freeAbove })} placeholder="Never" />}
        </Field>
        <div className="flex justify-end border-t border-slate-100 pt-5 sm:col-span-2">
          <Button loading={save.isPending} onClick={() => save.mutate({ flatFee: v.flatFee ?? 0, freeAbove: v.freeAbove ?? 0 })}>
            Save shipping
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

/* ───────────────────────── Moderation ───────────────────────── */

function ModerationSettings({ moderation }) {
  const save = useSaveSettings('moderation', 'Moderation settings saved')
  const rows = [
    {
      key: 'autoApproveVendors',
      label: 'Auto-approve vendors',
      description: 'Vendors go live as soon as they submit onboarding. Recommended off: verify GST & bank details first.',
    },
    {
      key: 'autoApproveCategories',
      label: 'Auto-approve vendor categories',
      description: 'Categories proposed by vendors appear on the storefront immediately.',
    },
    { key: 'autoApproveProducts', label: 'Auto-approve products', description: 'Products publish without review, and edits to live products stay live.' },
  ]
  return (
    <Card className="max-w-3xl">
      <CardHeader title="Approval workflow" description="When off, items wait in the review queue for an admin." />
      <CardBody className="flex flex-col divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.key} className="py-4 first:pt-0 last:pb-0">
            <Switch
              checked={moderation[r.key]}
              disabled={save.isPending}
              onCheckedChange={(v) => save.mutate({ [r.key]: v })}
              label={r.label}
              description={r.description}
            />
          </div>
        ))}
      </CardBody>
    </Card>
  )
}
