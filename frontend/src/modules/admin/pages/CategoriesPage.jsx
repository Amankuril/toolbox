import { zodResolver } from '@hookform/resolvers/zod'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, MoreHorizontal, Pencil, Plus, Star, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { flattenTree } from '@/core/lib/tree'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { FilterTabs, Menu, Switch } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { SearchField } from '@/ui/SearchField'
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
  const [filters, setFilters] = useSearchParamsState()
  const [editing, setEditing] = useState(null) // null | 'new' | category
  const [deleting, setDeleting] = useState(null)
  const params = {
    page: Number(filters.page ?? 1),
    limit: 50,
    status: filters.status || undefined,
    source: filters.source || undefined,
    q: filters.q || undefined,
  }
  const { data, isLoading } = useQuery({
    queryKey: adminKeys.categories(params),
    queryFn: () => adminApi.categories(params),
    placeholderData: keepPreviousData,
  })

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

  return (
    <>
      <PageHeader
        title="Categories"
        description="One shared 3-level tree. Vendor proposals appear here for approval."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New category
          </Button>
        }
      />
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
          empty={{ title: 'No categories', action: <Button onClick={() => setEditing('new')}>Create the first one</Button> }}
          columns={[
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
            { key: 'level', header: 'Level', cell: (c) => ['Root', 'Sub', 'Leaf'][c.level] },
            { key: 'source', header: 'Source', cell: (c) => (c.owner ? <Badge tone="info">{c.owner.store?.name ?? 'Vendor'}</Badge> : <Badge>Admin</Badge>) },
            { key: 'products', header: 'Products', className: 'text-right', cell: (c) => <span className="tabular">{c.productCount}</span> },
            { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            {
              key: 'actions',
              header: '',
              className: 'w-px whitespace-nowrap text-right',
              cell: (c) => (
                <div className="flex items-center justify-end gap-1">
                  {c.status === 'pending' && (
                    <>
                      <Button
                        size="xs"
                        variant="soft"
                        loading={review.isPending && review.variables?.id === c._id}
                        onClick={() => review.mutate({ id: c._id, action: 'approve' })}
                      >
                        <Check /> Approve
                      </Button>
                      <ReasonDialog
                        title={`Reject "${c.name}"`}
                        description="The vendor will see this reason."
                        confirmLabel="Reject"
                        onSubmit={(note) => review.mutateAsync({ id: c._id, action: 'reject', note })}
                        trigger={
                          <Button size="xs" variant="ghost" aria-label="Reject">
                            <X />
                          </Button>
                        }
                      />
                    </>
                  )}
                  <Menu
                    trigger={
                      <Button size="icon-sm" variant="ghost" aria-label="More actions">
                        <MoreHorizontal />
                      </Button>
                    }
                    items={[
                      { label: 'Edit', icon: Pencil, onSelect: () => setEditing(c) },
                      { label: c.isFeatured ? 'Unfeature' : 'Feature on home', icon: Star, onSelect: () => toggleFeatured.mutate(c) },
                      'separator',
                      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => setTimeout(() => setDeleting(c)) },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>

      <CategoryDialog category={editing} onClose={() => setEditing(null)} onSaved={refresh} />
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
})

function CategoryDialog({ category, onClose, onSaved }) {
  const isNew = category === 'new'
  const open = Boolean(category)
  const { data: tree } = useQuery({ queryKey: adminKeys.categoryTree, queryFn: adminApi.categoryTree, enabled: open })
  const options = useMemo(() => flattenTree(tree).filter((c) => c.level < 2 && (isNew || c._id !== category?._id)), [tree, isNew, category])

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
    })
  }, [open, isNew, category, form])

  const save = useMutation({
    mutationFn: ({ image, parent, ...v }) => {
      const body = { ...v, parent: parent || null, image: image[0] ? { media: image[0].media } : null }
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
        <Field label="Parent category" hint="Leave empty for a top-level category. Max 3 levels." className="sm:col-span-2">
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
          <p className="mb-1.5 text-sm font-medium text-slate-800">Image</p>
          <Controller
            name="image"
            control={control}
            render={({ field }) => <ImageUploader audience="admin" folder="categories" max={1} value={field.value ?? []} onChange={field.onChange} compact />}
          />
        </div>
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
