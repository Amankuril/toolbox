import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Star, X } from 'lucide-react'
import { useNavigate } from 'react-router'
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
  const [filters, setFilters] = useSearchParamsState()
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
          onRowClick={(p) => navigate(`/admin/products/${p._id}`)}
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
                    <p className="truncate text-xs text-slate-500">{[p.brand, p.sku].filter(Boolean).join(' · ') || '—'}</p>
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
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
    </>
  )
}
