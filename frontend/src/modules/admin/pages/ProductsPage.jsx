import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Eye, EyeOff, Layers, MessageSquareWarning, Star, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { PRODUCT_TYPE_LABEL, PRODUCT_TYPES } from '@/core/lib/constants'
import { formatINR, formatNumber } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { ActionDialog, RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { adminApi, adminKeys } from '../api'

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
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState()
  const [action, setAction] = useState(null)
  const params = {
    page: Number(filters.page ?? 1),
    limit: 20,
    status: filters.status || undefined,
    type: filters.type || undefined,
    vendor: filters.vendor || undefined,
    q: filters.q || undefined,
    featured: filters.featured || undefined,
  }
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
      <PageHeader title="Products" description="Moderate listings from every vendor." />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Name, SKU, brand or model" />
          <Select value={filters.type ?? ''} onChange={(e) => setFilters({ type: e.target.value })} className="w-auto">
            <option value="">All types</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select value={filters.featured ?? ''} onChange={(e) => setFilters({ featured: e.target.value })} className="w-auto">
            <option value="">Featured: any</option>
            <option value="true">Featured only</option>
          </Select>
          {filters.vendor && (
            <Button variant="soft" size="sm" onClick={() => setFilters({ vendor: '' })}>
              Vendor: {vendorName ?? 'selected'} <X />
            </Button>
          )}
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
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
                        <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600" title="Has bulk pricing">
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
                    p.status === 'active' && p.vendorApproved && { label: 'View on store', icon: ExternalLink, onSelect: () => window.open(`/p/${p.slug}`, '_blank', 'noopener') },
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
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>

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
