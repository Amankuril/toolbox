import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Pencil, Plus, Share2, Star, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { MAX_CATEGORY_DEPTH } from '@/core/lib/constants'
import { taxPayload, taxToForm } from '@/core/lib/tax'
import { flattenTree } from '@/core/lib/tree'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { FilterTabs, Switch } from '@/ui/Controls'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { RowActions } from '@/ui/RowActions'
import { SearchField } from '@/ui/SearchField'
import { CategoryTaxFields } from '@/modules/shared/CategoryTaxFields'
import { LevelTabs } from '@/modules/shared/CategoryTabs'
import { categoryShareItem, useShare } from '@/modules/shared/share'
import { useBranding } from '@/core/settings/usePublicSettings'
import { adminApi, adminKeys } from '../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'inactive', label: 'Inactive' },
]

export default function CategoriesPage() {
  const qc = useQueryClient()
  const { siteName } = useBranding()
  const { share, dialog: shareDialog } = useShare()
  const [filters, setFilters] = useSearchParamsState()
  const [editing, setEditing] = useState(null) // null | 'new' | category
  const [deleting, setDeleting] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const shared = { status: filters.status || undefined, source: filters.source || undefined, q: filters.q || undefined }
  // Two tabs: the top-level departments, and everything under them.
  const level = filters.level === 'sub' ? 'sub' : 'top'
  const other = level === 'top' ? 'sub' : 'top'
  const params = { ...shared, level, page: Number(filters.page ?? 1), limit: pageSize(filters.limit, 50) }
  const { data, isLoading } = useQuery({
    queryKey: adminKeys.categories(params),
    queryFn: () => adminApi.categories(params),
    placeholderData: keepPreviousData,
  })
  // Just the count for the other tab's label.
  const otherParams = { ...shared, level: other, page: 1, limit: 1 }
  const { data: otherData } = useQuery({ queryKey: adminKeys.categories(otherParams), queryFn: () => adminApi.categories(otherParams) })
  const counts = { [level]: data?.meta?.total, [other]: otherData?.meta?.total }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'categories'] })
    qc.invalidateQueries({ queryKey: adminKeys.categoryTree })
    qc.invalidateQueries({ queryKey: adminKeys.dashboard })
  }
  const onError = (err) => toast.error(errorMessage(err))
  const review = useMutation({
    mutationFn: ({ id, ...body }) => adminApi.reviewCategory(id, body),
    onSuccess: (_d, v) => (refresh(), toast.success(v.action === 'approve' ? 'Category approved' : 'Category rejected')),
    onError,
  })
  const remove = useMutation({ mutationFn: (id) => adminApi.deleteCategory(id), onSuccess: () => (refresh(), toast.success('Category deleted')), onError })
  const toggleFeatured = useMutation({ mutationFn: (c) => adminApi.updateCategory(c._id, { isFeatured: !c.isFeatured }), onSuccess: refresh, onError })

  const columns = [
    {
      key: 'name',
      header: 'Category',
      cell: (c) => (
        <div className="flex items-center gap-3">
          <Thumb src={c.image?.url} className="size-10 shrink-0 rounded-md border border-slate-200" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium text-slate-900">
              {c.name} {c.isFeatured && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Featured" />}
            </p>
            <p className="truncate text-xs text-slate-500">
              {c.parent ? `in ${c.parent.name}` : 'Top level'} · /{c.slug}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'level', header: 'Level', cell: (c) => (c.level === 0 ? 'Top' : `Level ${c.level + 1}`) },
    {
      key: 'tax',
      header: 'HSN · GST',
      cell: (c) =>
        c.tax?.hsnCode || c.tax?.gstRate != null ? (
          <span className="tabular text-sm">
            {c.tax.hsnCode ?? '—'} · {c.tax.gstRate != null ? `${c.tax.gstRate}%` : '—'}
          </span>
        ) : (
          <span className="text-xs text-slate-400">{c.parent ? 'From parent' : 'Not set'}</span>
        ),
    },
    { key: 'source', header: 'Source', cell: (c) => (c.owner ? <Badge tone="info">{c.owner.store?.name ?? 'Vendor'}</Badge> : <Badge>Admin</Badge>) },
    { key: 'products', header: 'Products', className: 'text-right', cell: (c) => <span className="tabular">{c.productCount}</span> },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'actions',
      header: '',
      className: 'w-px',
      cell: (c) => (
        <RowActions
          label={`Actions for ${c.name}`}
          items={[
            c.status === 'active' && { label: 'View on store', icon: ExternalLink, onSelect: () => window.open(`/c/${c.slug}`, '_blank', 'noopener') },
            c.status === 'active' && { label: 'Share category', icon: Share2, onSelect: () => share(categoryShareItem(c, siteName, { productCount: c.productCount })) },
            { label: 'Edit', icon: Pencil, onSelect: () => setEditing(c) },
            c.status === 'pending' && 'separator',
            c.status === 'pending' && { label: 'Approve', icon: Check, onSelect: () => review.mutate({ id: c._id, action: 'approve' }) },
            c.status === 'pending' && { label: 'Reject', icon: X, onSelect: () => setRejecting(c) },
            'separator',
            c.status === 'active' && {
              label: c.isFeatured ? 'Remove from home' : 'Feature on home',
              icon: Star,
              onSelect: () => toggleFeatured.mutate(c),
            },
            { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(c) },
          ]}
        />
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Categories"
        description="One shared category tree. HSN and GST set here apply to every product filed under it. Vendor proposals appear here for approval."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New category
          </Button>
        }
      />
      <LevelTabs value={level} counts={counts} onChange={(next) => setFilters({ level: next === 'top' ? undefined : next })} />
      <Card>
        <div className="px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status })} options={TABS} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Search categories" />
          <Select value={filters.source ?? ''} onChange={(e) => setFilters({ source: e.target.value })} className="w-auto">
            <option value="">All sources</option>
            <option value="platform">Created by admin</option>
            <option value="vendor">Proposed by vendors</option>
          </Select>
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={
            level === 'top'
              ? { title: 'No top categories', action: <Button onClick={() => setEditing('new')}>Create the first one</Button> }
              : { title: 'No sub-categories', description: 'Add one under a top category.' }
          }
          columns={columns}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onLimitChange={(limit) => setFilters({ limit })} />
      </Card>

      <CategoryDialog category={editing} onClose={() => setEditing(null)} onSaved={refresh} />
      {shareDialog}
      <ReasonDialog
        key={rejecting?._id}
        open={Boolean(rejecting)}
        onOpenChange={(v) => !v && setRejecting(null)}
        title={`Reject “${rejecting?.name}”`}
        description="The vendor who proposed it sees this reason."
        confirmLabel="Reject"
        onSubmit={(note) => review.mutateAsync({ id: rejecting._id, action: 'reject', note })}
      />
      {/* Lives outside the row menu: Radix menus close on select, which would unmount a nested dialog. */}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Only empty categories (no sub-categories or products) can be deleted. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync(deleting._id)}
      />
    </>
  )
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  parent: z.string().optional(),
  description: z.string().trim().max(2000).optional(),
  image: z.array(z.object({ media: z.string(), url: z.string() })).max(1),
  sortOrder: z.coerce.number().int().min(-10000).max(10000),
  isFeatured: z.boolean(),
  status: z.enum(['active', 'pending', 'rejected', 'inactive']),
  tax: z.object({
    hsnCode: z.string().regex(/^(\d{4}|\d{6}|\d{8})?$/, 'Use 4, 6 or 8 digits'),
    gstRate: z.string(),
  }),
})

function CategoryDialog({ category, onClose, onSaved }) {
  const isNew = category === 'new'
  const open = Boolean(category)
  const { data: tree } = useQuery({ queryKey: adminKeys.categoryTree, queryFn: adminApi.categoryTree, enabled: open })
  const options = useMemo(
    () => flattenTree(tree).filter((c) => c.level < MAX_CATEGORY_DEPTH - 1 && (isNew || c._id !== category?._id)),
    [tree, isNew, category],
  )

  const form = useForm({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (!open) return
    const c = isNew ? {} : category
    form.reset({
      name: c.name ?? '',
      parent: (c.parent?._id ?? c.parent) || '',
      description: c.description ?? '',
      image: c.image ? [c.image] : [],
      sortOrder: c.sortOrder ?? 0,
      isFeatured: c.isFeatured ?? false,
      status: c.status ?? 'active',
      tax: taxToForm(c.tax),
    })
  }, [open, isNew, category, form])

  const save = useMutation({
    mutationFn: ({ image, parent, tax, ...v }) => {
      const body = { ...v, parent: parent || null, image: image[0] ? { media: image[0].media } : null, tax: taxPayload(tax) }
      return isNew ? adminApi.createCategory(body) : adminApi.updateCategory(category._id, body)
    },
    onSuccess: () => {
      toast.success(isNew ? 'Category created' : 'Category updated')
      onSaved()
      onClose()
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })

  const { register, control, formState } = form
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={isNew ? 'New category' : `Edit ${category?.name}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            {isNew ? 'Create category' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <Field label="Name" required error={formState.errors.name?.message} className="sm:col-span-2">
          {(p) => <Input {...p} {...register('name')} autoFocus />}
        </Field>
        <Field label="Parent category" hint={`Leave empty for a top-level category. Up to ${MAX_CATEGORY_DEPTH} levels deep.`} className="sm:col-span-2">
          {(p) => (
            <Select {...p} {...register('parent')}>
              <option value="">— Top level —</option>
              {options.map((o) => (
                <option key={o._id} value={o._id}>
                  {'  '.repeat(o.depth * 2)}
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">
          {(p) => <Textarea {...p} rows={3} {...register('description')} />}
        </Field>
        <div className="sm:col-span-2">
          <p className="text-sm font-medium text-slate-800">Image / icon</p>
          <p className="mb-1.5 text-xs text-slate-500">Shown to buyers in the department menu and on category pages, for sub-categories too. A square image works best.</p>
          <Controller
            name="image"
            control={control}
            render={({ field }) => <ImageUploader audience="admin" folder="categories" max={1} value={field.value ?? []} onChange={field.onChange} compact />}
          />
        </div>
        <Controller
          name="tax"
          control={control}
          render={({ field }) => (
            <CategoryTaxFields
              className="sm:col-span-2"
              value={field.value}
              onChange={field.onChange}
              errors={{ hsnCode: formState.errors.tax?.hsnCode?.message, gstRate: formState.errors.tax?.gstRate?.message }}
            />
          )}
        />
        <Field label="Status">
          {(p) => (
            <Select {...p} {...register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </Select>
          )}
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first">
          {(p) => <Input {...p} type="number" {...register('sortOrder')} />}
        </Field>
        <div className="sm:col-span-2">
          <Controller
            name="isFeatured"
            control={control}
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Feature on home page"
                description="Shows this category in the home page category grid."
              />
            )}
          />
        </div>
      </form>
    </Dialog>
  )
}
