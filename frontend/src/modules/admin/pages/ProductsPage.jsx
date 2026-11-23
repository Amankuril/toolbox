import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Eye,
  EyeOff,
  Layers,
  MessageSquareWarning,
  Pencil,
  Plus,
  Share2,
  Sheet,
  Star,
  StarOff,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { PRODUCT_TYPE_LABEL, PRODUCT_TYPES } from '@/core/lib/constants'
import { formatINR, formatNumber, toPaise } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { FilterTabs, Menu } from '@/ui/Controls'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { Input, Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { ActionDialog, RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { BulkActionBar } from '@/modules/shared/BulkActionBar'
import { downloadPdf } from '@/modules/shared/download'
import { BulkEditSheet } from '@/modules/shared/BulkEditSheet'
import { productShareItem, useShare } from '@/modules/shared/share'
import { useBranding } from '@/core/settings/usePublicSettings'
import { useAdminAccess } from '../access'
import { adminApi, adminKeys } from '../api'
import { CategoryFilter, StockFilter } from '@/ui/Filters'
import { flattenTree } from '@/core/lib/tree'

const BULK_ACTIONS = [
  { key: 'approve', label: 'Approve', icon: Check },
  { key: 'show', label: 'Show on store', icon: Eye },
  { key: 'hide', label: 'Hide', icon: EyeOff },
  { key: 'feature', label: 'Feature', icon: Star },
  { key: 'unfeature', label: 'Unfeature', icon: StarOff },
  {
    key: 'delete',
    label: 'Delete',
    icon: Trash2,
    danger: true,
    confirm: {
      title: (n) => `Delete ${n} product${n === 1 ? '' : 's'}?`,
      description: 'They are removed from the store and from this list. Orders that include them keep their full history.',
      label: 'Delete',
    },
  },
]
const BULK_DONE = { approve: 'approved', show: 'live', hide: 'hidden', feature: 'featured', unfeature: 'removed from featured', delete: 'deleted' }

const SORTS = [
  { value: '', label: 'Sort: recently updated' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name_asc', label: 'Name: A to Z' },
  { value: 'name_desc', label: 'Name: Z to A' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'stock_asc', label: 'Stock: low to high' },
  { value: 'stock_desc', label: 'Stock: high to low' },
]

/** URL keeps whole rupees; the API takes paise. */
const rupeesToPaise = (v) => (v && Number(v) >= 0 ? toPaise(v) : undefined)

const TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending review' },
  { value: 'active', label: 'Live' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'inactive', label: 'Hidden' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
]

export default function ProductsPage() {
  const navigate = useNavigate()
  const { siteName } = useBranding()
  const { share, dialog: shareDialog } = useShare()
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState()
  const [action, setAction] = useState(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const { can } = useAdminAccess()
  // A new filter or page shows other rows: start the ticks over.
  const setFiltersAndClear = (next) => {
    setSelected(new Set())
    setFilters(next)
  }
  const params = {
    page: Number(filters.page ?? 1),
    limit: pageSize(filters.limit),
    status: filters.status || undefined,
    type: filters.type || undefined,
    vendor: filters.vendor || undefined,
    q: filters.q || undefined,
    featured: filters.featured || undefined,
    category: filters.category || undefined,
    stock: filters.stock || undefined,
    variants: filters.variants || undefined,
    minPrice: rupeesToPaise(filters.minPrice),
    maxPrice: rupeesToPaise(filters.maxPrice),
    sort: filters.sort || undefined,
  }
  const { data: tree } = useQuery({ queryKey: adminKeys.categoryTree, queryFn: adminApi.categoryTree, staleTime: 5 * 60_000 })
  const categoryOptions = useMemo(() => flattenTree(tree ?? []), [tree])
  const { data, isLoading } = useQuery({ queryKey: adminKeys.products(params), queryFn: () => adminApi.products(params), placeholderData: keepPreviousData })
  const vendorName = filters.vendor && data?.items?.[0]?.vendor?.store?.name

  const run = (fn, message) => async (row, note) => {
    try {
      await fn(row, note)
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      qc.invalidateQueries({ queryKey: adminKeys.product(row._id) })
      qc.invalidateQueries({ queryKey: adminKeys.dashboard })
      toast.success(message)
    } catch (err) {
      toast.error(errorMessage(err))
      throw err
    }
  }
  const quick = (row, body, message) => run(() => adminApi.updateProduct(row._id, body), message)(row).catch(() => {})

  return (
    <>
      <PageHeader
        title="Products"
        description="Moderate listings from every vendor."
        actions={
          <>
            <CatalogPdfButton params={params} />
            <Button variant="outline" asChild>
              <Link to="/admin/products/import">
                <Upload /> Bulk upload
              </Link>
            </Button>
            {can('products', 'manage') && (
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <Sheet /> Bulk edit
              </Button>
            )}
            {can('store', 'manage') && (
              <Button asChild>
                <Link to="/admin/store/products/new">
                  <Plus /> Add to our store
                </Link>
              </Button>
            )}
          </>
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFiltersAndClear({ status })} options={TABS} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFiltersAndClear({ q })} placeholder="Name, SKU, brand or model" />
          <Select value={filters.type ?? ''} onChange={(e) => setFiltersAndClear({ type: e.target.value })} className="w-auto">
            <option value="">All types</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <CategoryFilter options={categoryOptions} value={filters.category} onChange={(category) => setFiltersAndClear({ category })} />
          <StockFilter value={filters.stock} onChange={(stock) => setFiltersAndClear({ stock })} />
          <Select value={filters.featured ?? ''} onChange={(e) => setFiltersAndClear({ featured: e.target.value })} className="w-auto">
            <option value="">Featured: any</option>
            <option value="true">Featured only</option>
          </Select>
          <Select value={filters.variants ?? ''} onChange={(e) => setFiltersAndClear({ variants: e.target.value })} className="w-auto">
            <option value="">Variants: any</option>
            <option value="with">With variants</option>
            <option value="without">Without variants</option>
          </Select>
          <PriceRangeFilter
            key={`${filters.minPrice ?? ''}-${filters.maxPrice ?? ''}`}
            min={filters.minPrice}
            max={filters.maxPrice}
            onChange={(minPrice, maxPrice) => setFiltersAndClear({ minPrice, maxPrice })}
          />
          <Select value={filters.sort ?? ''} onChange={(e) => setFiltersAndClear({ sort: e.target.value })} className="w-auto" aria-label="Sort products">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          {filters.vendor && (
            <Button variant="soft" size="sm" onClick={() => setFiltersAndClear({ vendor: '' })}>
              Vendor: {vendorName ?? 'selected'} <X />
            </Button>
          )}
        </div>
        {can('products', 'manage') && (
          <BulkActionBar
            selected={selected}
            onClear={() => setSelected(new Set())}
            actions={BULK_ACTIONS}
            done={BULK_DONE}
            run={adminApi.productBulkAction}
            onDone={() => {
              qc.invalidateQueries({ queryKey: ['admin', 'products'] })
              qc.invalidateQueries({ queryKey: adminKeys.dashboard })
            }}
          />
        )}
        <DataTable
          loading={isLoading}
          rows={data?.items}
          selected={can('products', 'manage') ? selected : undefined}
          onSelectedChange={setSelected}
          rowLabel={(p) => p.name}
          empty={{ title: 'No products found', description: 'Try a different filter.' }}
          columns={[
            {
              key: 'name',
              header: 'Product',
              cell: (p) => (
                <div className="flex items-center gap-3">
                  <Thumb src={p.images?.[0]?.url} className="size-11 shrink-0 rounded-md border border-slate-200" />
                  <div className="min-w-0">
                    <p className="flex max-w-xs items-center gap-1.5 truncate font-medium text-slate-900">
                      {p.name}
                      {p.isFeatured && <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Featured" />}
                    </p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                      {[p.brand, p.sku].filter(Boolean).join(' · ') || '—'}
                      {p.bulkPricing?.tiers?.length > 0 && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600"
                          title="Has bulk pricing"
                        >
                          <Layers className="size-3" /> Bulk
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ),
            },
            { key: 'type', header: 'Type', cell: (p) => <Badge>{PRODUCT_TYPE_LABEL[p.type]}</Badge> },
            { key: 'vendor', header: 'Vendor', cell: (p) => <span className="text-slate-700">{p.vendor?.store?.name ?? '—'}</span> },
            { key: 'category', header: 'Category', cell: (p) => p.category?.name ?? '—' },
            { key: 'price', header: 'Price', className: 'text-right', cell: (p) => <span className="tabular font-medium">{formatINR(p.pricing.price)}</span> },
            {
              key: 'stock',
              header: 'Stock',
              className: 'text-right',
              cell: (p) => <span className={`tabular ${p.inventory.stock === 0 ? 'text-red-600' : ''}`}>{formatNumber(p.inventory.stock)}</span>,
            },
            { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
            {
              key: 'actions',
              header: '',
              className: 'w-px',
              cell: (p) => (
                <RowActions
                  label={`Actions for ${p.name}`}
                  items={[
                    { label: 'View details', icon: Eye, onSelect: () => navigate(`/admin/products/${p._id}`) },
                    can('products', 'manage') &&
                      p.status !== 'archived' && { label: 'Edit product', icon: Pencil, onSelect: () => navigate(`/admin/products/${p._id}/edit`) },
                    can('store', 'manage') && { label: 'Clone to our store', icon: Copy, onSelect: () => navigate(`/admin/store/products/new?clone=${p._id}`) },
                    p.status === 'active' &&
                      p.vendorApproved && { label: 'View on store', icon: ExternalLink, onSelect: () => window.open(`/p/${p.slug}`, '_blank', 'noopener') },
                    p.status === 'active' && p.vendorApproved && { label: 'Share product', icon: Share2, onSelect: () => share(productShareItem(p, siteName)) },
                    ['pending', 'rejected'].includes(p.status) && 'separator',
                    ['pending', 'rejected'].includes(p.status) && { label: 'Approve', icon: Check, onSelect: () => setAction({ type: 'approve', row: p }) },
                    p.status === 'pending' && { label: 'Reject', icon: MessageSquareWarning, onSelect: () => setAction({ type: 'reject', row: p }) },
                    'separator',
                    !['archived', 'rejected'].includes(p.status) && {
                      label: p.isFeatured ? 'Remove from featured' : 'Feature on home',
                      icon: Star,
                      onSelect: () => quick(p, { isFeatured: !p.isFeatured }, p.isFeatured ? 'Removed from featured' : 'Featured on home'),
                    },
                    p.status === 'active' && { label: 'Hide from store', icon: EyeOff, danger: true, onSelect: () => setAction({ type: 'hide', row: p }) },
                    p.status === 'inactive' && { label: 'Show on store', icon: Eye, onSelect: () => quick(p, { status: 'active' }, 'Product is live') },
                  ]}
                />
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFiltersAndClear({ page })} onLimitChange={(limit) => setFiltersAndClear({ limit })} />
      </Card>

      {shareDialog}
      <BulkEditSheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        filters={{ status: params.status, type: params.type, vendor: params.vendor, q: params.q, featured: params.featured }}
        queryKey={['admin', 'products', 'bulk-sheet']}
        load={adminApi.products}
        save={adminApi.bulkUpdateProducts}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ['admin', 'products'] })
          qc.invalidateQueries({ queryKey: adminKeys.dashboard })
        }}
        showVendor
      />

      <ActionDialog
        action={action}
        onClose={() => setAction(null)}
        configs={{
          approve: {
            kind: 'confirm',
            title: (p) => `Approve “${p.name}”?`,
            description: (p) => (p.vendorApproved ? 'It goes live on the storefront immediately.' : 'It goes live once the vendor is approved.'),
            confirmLabel: 'Approve',
            tone: 'primary',
            run: run((p) => adminApi.reviewProduct(p._id, { action: 'approve' }), 'Product approved'),
          },
          reject: {
            kind: 'reason',
            title: (p) => `Reject “${p.name}”`,
            description: 'The vendor sees this note on the product and can fix and resubmit.',
            label: 'What should the vendor change?',
            confirmLabel: 'Reject',
            run: run((p, note) => adminApi.reviewProduct(p._id, { action: 'reject', note }), 'Sent back to vendor'),
          },
          hide: {
            kind: 'confirm',
            title: (p) => `Hide “${p.name}”?`,
            description: 'Buyers can no longer find or order it. You can show it again any time.',
            confirmLabel: 'Hide product',
            run: run((p) => adminApi.updateProduct(p._id, { status: 'inactive' }), 'Product hidden'),
          },
        }}
      />
    </>
  )
}

/** "₹ min – ₹ max" in whole rupees; applies on Enter or when a box loses focus. */
function PriceRangeFilter({ min, max, onChange }) {
  const [lo, setLo] = useState(min ?? '')
  const [hi, setHi] = useState(max ?? '')
  const apply = () => {
    let [a, b] = [lo, hi]
    // Typed the wrong way round: swap rather than show nothing.
    if (a && b && Number(a) > Number(b)) [a, b] = [b, a]
    if (a !== (min ?? '') || b !== (max ?? '')) onChange(a, b)
  }
  const field = (value, set, label) => (
    <Input
      prefix="₹"
      inputMode="numeric"
      value={value}
      onChange={(e) => set(e.target.value.replace(/\D/g, ''))}
      onBlur={apply}
      onKeyDown={(e) => e.key === 'Enter' && apply()}
      placeholder={label}
      aria-label={`${label} price`}
      className="w-28"
    />
  )
  return (
    <div className="flex items-center gap-1.5 text-sm text-slate-600">
      {field(lo, setLo, 'Min')}
      <span aria-hidden>–</span>
      {field(hi, setHi, 'Max')}
      {(min || max) && (
        <Button variant="ghost" size="icon-sm" aria-label="Clear price range" onClick={() => onChange('', '')}>
          <X />
        </Button>
      )}
    </div>
  )
}

/** Product catalogue PDF: what the current filters match, or every product. Both follow the chosen sort. */
function CatalogPdfButton({ params }) {
  const [busy, setBusy] = useState(false)
  const { page: _page, limit: _limit, sort, ...filters } = params
  const filtered = Object.values(filters).some((v) => v !== undefined)
  const download = async (query) => {
    setBusy(true)
    const toastId = toast.loading('Preparing the PDF… large catalogues take a minute')
    try {
      await downloadPdf(() => adminApi.productCatalogPdf(query), 'Product-catalogue.pdf')
    } finally {
      toast.dismiss(toastId)
      setBusy(false)
    }
  }
  return (
    <Menu
      trigger={
        <Button variant="outline" loading={busy}>
          <Download /> Download PDF <ChevronDown />
        </Button>
      }
      items={[
        filtered && { label: 'Matching current filters', icon: FileText, onSelect: () => download({ ...filters, sort }) },
        { label: 'All products', icon: FileText, onSelect: () => download({ sort }) },
      ]}
    />
  )
}
