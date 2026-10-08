import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Download, Eye, EyeOff, IndianRupee, MoreHorizontal, Package, PackagePlus, Pencil, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { PRODUCT_TYPE_LABEL, PRODUCT_TYPES } from '@/core/lib/constants'
import { formatINR, formatNumber, formatRelative } from '@/core/lib/format'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, EmptyState } from '@/ui/Card'
import { FilterTabs, Menu, Switch, Tooltip } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { Field, Select } from '@/ui/Field'
import { NumberInput, PriceInput } from '@/ui/inputs'
import { PageHeader } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { useSeller } from '../seller'

const TABS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Live' },
  { value: 'pending', label: 'In review' },
  { value: 'rejected', label: 'Needs changes' },
  { value: 'draft', label: 'Drafts' },
  { value: 'inactive', label: 'Hidden' },
]

export default function VendorProductsPage() {
  const seller = useSeller()
  const vendor = seller.useAccount()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState()
  const [quickEdit, setQuickEdit] = useState(null)
  const [archiving, setArchiving] = useState(null)
  const approved = vendor?.status === 'approved'
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, type: filters.type || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({
    queryKey: seller.keys.products(params),
    queryFn: () => seller.api.products(params),
    placeholderData: keepPreviousData,
  })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [...seller.keys.all, 'products'] })
    qc.invalidateQueries({ queryKey: seller.keys.dashboard })
  }
  const onError = (err) => toast.error(errorMessage(err))
  const visibility = useMutation({
    mutationFn: ({ id, visible }) => seller.api.setVisibility(id, visible),
    onSuccess: (_d, v) => (refresh(), toast.success(v.visible ? 'Product is live' : 'Product hidden')),
    onError,
  })
  const availability = useMutation({
    mutationFn: ({ id, available }) => seller.api.quickUpdate(id, { available }),
    onSuccess: (_d, v) => (refresh(), toast.success(v.available ? 'Marked available' : 'Marked not available')),
    onError,
  })
  const archive = useMutation({ mutationFn: (id) => seller.api.archiveProduct(id), onSuccess: () => (refresh(), toast.success('Product archived')), onError })

  const addButton = (
    <Tooltip content={!approved && 'You can add products once your store is approved'}>
      <span>
        <Button asChild={approved} disabled={!approved}>
          {approved ? (
            <Link to={`${seller.base}/products/new`}>
              <PackagePlus /> Add product
            </Link>
          ) : (
            <>
              <PackagePlus /> Add product
            </>
          )}
        </Button>
      </span>
    </Tooltip>
  )

  const headerActions = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => seller.api.productImports.exportProducts('xlsx').catch(onError)}>
        <Download /> Export (Excel)
      </Button>
      {approved && (
        <Button variant="outline" asChild>
          <Link to={`${seller.base}/products/import`}>
            <Upload /> Bulk upload
          </Link>
        </Button>
      )}
      {addButton}
    </div>
  )

  const noProductsYet = !isLoading && !data?.items?.length && !filters.status && !filters.q && !filters.type

  return (
    <>
      <PageHeader title="Products" description="Tools, machinery and spare parts you sell." actions={headerActions} />
      {noProductsYet ? (
        <Card>
          <EmptyState
            icon={Package}
            title="List your first product"
            description="Add photos, pricing with GST and stock. Spare parts can be linked to the machines they fit."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {addButton}
                {approved && (
                  <Button variant="outline" asChild>
                    <Link to={`${seller.base}/products/import`}>
                      <Upload /> Bulk upload from a spreadsheet
                    </Link>
                  </Button>
                )}
              </div>
            }
          />
        </Card>
      ) : (
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
          </div>
          <DataTable
            loading={isLoading}
            rows={data?.items}
            onRowClick={(p) => navigate(`${seller.base}/products/${p._id}`)}
            empty={{ title: 'No products match', description: 'Try a different filter.' }}
            columns={[
              {
                key: 'name',
                header: 'Product',
                cell: (p) => (
                  <div className="flex items-center gap-3">
                    <Thumb src={p.images?.[0]?.url} className="size-11 shrink-0 rounded-md border border-slate-200" />
                    <div className="min-w-0">
                      <p className="max-w-xs truncate font-medium text-slate-900">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">{[p.sku && `SKU ${p.sku}`, p.category?.name].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                ),
              },
              { key: 'type', header: 'Type', cell: (p) => <Badge>{PRODUCT_TYPE_LABEL[p.type]}</Badge> },
              {
                key: 'price',
                header: 'Price',
                className: 'text-right',
                cell: (p) => (
                  <div>
                    <p className="tabular font-medium">{formatINR(p.pricing.price)}</p>
                    {p.pricing.mrp > p.pricing.price && <p className="tabular text-xs text-slate-400 line-through">{formatINR(p.pricing.mrp)}</p>}
                  </div>
                ),
              },
              {
                key: 'stock',
                header: 'Stock',
                className: 'text-right',
                cell: (p) =>
                  p.inventory.trackQuantity === false ? (
                    <span className="text-xs text-slate-500">Not tracked</span>
                  ) : (
                    <span className={`tabular font-medium ${p.inventory.stock === 0 ? 'text-red-600' : p.inventory.stock <= 5 ? 'text-amber-700' : ''}`}>
                      {formatNumber(p.inventory.stock)}
                      {p.variants?.length > 0 && <span className="block text-xs font-normal text-slate-500">{p.variants.length} variants</span>}
                    </span>
                  ),
              },
              {
                key: 'available',
                header: 'Available',
                cell: (p) => (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Tooltip
                      content={
                        p.inventory.available === false
                          ? 'Not available to buy'
                          : p.inventory.trackQuantity === false
                            ? 'Available (quantity not tracked)'
                            : 'Available while in stock'
                      }
                    >
                      <span>
                        <Switch
                          checked={p.inventory.available !== false}
                          disabled={!approved || (availability.isPending && availability.variables?.id === p._id)}
                          onCheckedChange={(available) => availability.mutate({ id: p._id, available })}
                        />
                      </span>
                    </Tooltip>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (p) => (
                  <Tooltip content={p.status === 'rejected' && p.moderation?.note}>
                    <span>
                      <StatusBadge status={p.status} />
                    </span>
                  </Tooltip>
                ),
              },
              { key: 'updated', header: 'Updated', cell: (p) => <span className="text-slate-500">{formatRelative(p.updatedAt)}</span> },
              {
                key: 'actions',
                header: '',
                className: 'w-px text-right',
                cell: (p) => (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Menu
                      trigger={
                        <Button size="icon-sm" variant="ghost" aria-label="Product actions">
                          <MoreHorizontal />
                        </Button>
                      }
                      items={[
                        { label: 'Edit', icon: Pencil, onSelect: () => navigate(`${seller.base}/products/${p._id}`) },
                        // Variant products are priced per variant in the editor.
                        approved && !p.variants?.length && { label: 'Update price & stock', icon: IndianRupee, onSelect: () => setQuickEdit(p) },
                        approved &&
                          p.status === 'active' && { label: 'Hide from store', icon: EyeOff, onSelect: () => visibility.mutate({ id: p._id, visible: false }) },
                        approved &&
                          p.status === 'inactive' && { label: 'Show on store', icon: Eye, onSelect: () => visibility.mutate({ id: p._id, visible: true }) },
                        'separator',
                        { label: 'Archive', icon: Archive, danger: true, onSelect: () => setArchiving(p) },
                      ]}
                    />
                  </div>
                ),
              },
            ]}
          />
          <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
        </Card>
      )}

      <QuickEditDialog product={quickEdit} onClose={() => setQuickEdit(null)} onSaved={refresh} />
      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(v) => !v && setArchiving(null)}
        title={`Archive "${archiving?.name}"?`}
        description="It will be removed from the store and your product list. Past orders are not affected."
        confirmLabel="Archive"
        onConfirm={() => archive.mutateAsync(archiving._id)}
      />
    </>
  )
}

function QuickEditDialog({ product, onClose, onSaved }) {
  const seller = useSeller()
  const [v, setV] = useState(null)
  const current =
    product && (v?.id === product._id ? v : { id: product._id, stock: product.inventory.stock, price: product.pricing.price, mrp: product.pricing.mrp })
  const save = useMutation({
    mutationFn: () =>
      seller.api.quickUpdate(product._id, {
        ...(product.inventory.trackQuantity !== false ? { stock: current.stock ?? 0 } : {}),
        price: current.price,
        mrp: current.mrp,
      }),
    onSuccess: () => {
      onSaved()
      toast.success('Price & stock updated')
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const invalid = current && (!current.price || !current.mrp || current.price > current.mrp)
  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(open) => !open && onClose()}
      title="Update price & stock"
      description={product?.name}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      {current && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="MRP">{(p) => <PriceInput {...p} value={current.mrp} onChange={(mrp) => setV({ ...current, mrp })} />}</Field>
          <Field label="Selling price" error={current.price > current.mrp ? 'Cannot exceed MRP' : undefined}>
            {(p) => <PriceInput {...p} value={current.price} onChange={(price) => setV({ ...current, price })} />}
          </Field>
          {product.inventory.trackQuantity !== false && (
            <Field label="Stock" hint="Price & stock changes don't need re-approval" className="sm:col-span-2">
              {(p) => <NumberInput {...p} value={current.stock} onChange={(stock) => setV({ ...current, stock })} />}
            </Field>
          )}
        </div>
      )}
    </Dialog>
  )
}
