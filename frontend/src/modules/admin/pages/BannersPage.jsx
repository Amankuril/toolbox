import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageIcon, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { formatDate } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, EmptyState, Skeleton } from '@/ui/Card'
import { ConfirmDialog, Dialog } from '@/ui/Dialog'
import { Field, Input, Select } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { PageHeader } from '@/ui/PageHeader'
import { adminApi, adminKeys } from '../api'

const PLACEMENTS = [
  { value: 'home_hero', label: 'Home — hero carousel', hint: 'Wide banner at the top of the home page. 1600×500 recommended.' },
  { value: 'home_offer', label: 'Home — offer tiles', hint: 'Shown as a row of tiles below categories. 800×400 recommended.' },
  { value: 'home_strip', label: 'Home — promo strip', hint: 'Full-width strip between product rails. 1600×240 recommended.' },
]

export default function BannersPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const { data: banners, isLoading } = useQuery({ queryKey: adminKeys.banners, queryFn: adminApi.banners })
  const remove = useMutation({
    mutationFn: (id) => adminApi.deleteBanner(id),
    onSuccess: () => (qc.invalidateQueries({ queryKey: adminKeys.banners }), toast.success('Banner deleted')),
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <>
      <PageHeader
        title="Banners"
        description="Promotional banners on the storefront home page."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New banner
          </Button>
        }
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !banners?.length ? (
        <Card>
          <EmptyState
            icon={ImageIcon}
            title="No banners yet"
            description="Add a hero banner to make the home page stand out."
            action={<Button onClick={() => setEditing('new')}>Add banner</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {PLACEMENTS.map((p) => {
            const rows = banners.filter((b) => b.placement === p.value)
            if (!rows.length) return null
            return (
              <section key={p.value}>
                <h2 className="mb-3 text-sm font-semibold text-slate-700">{p.label}</h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {rows.map((b) => (
                    <Card key={b._id} className="overflow-hidden">
                      <img src={b.image.url} alt={b.title} className="aspect-[16/5] w-full bg-slate-100 object-cover" loading="lazy" />
                      <div className="flex items-start justify-between gap-3 p-4">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{b.title}</p>
                          <p className="truncate text-xs text-slate-500">
                            {b.link || 'No link'} · Order {b.sortOrder}
                            {(b.startsAt || b.endsAt) && ` · ${formatDate(b.startsAt)} → ${formatDate(b.endsAt)}`}
                          </p>
                          <StatusBadge status={b.status} className="mt-2" />
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="Edit banner" onClick={() => setEditing(b)}>
                            <Pencil />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Delete banner" onClick={() => setDeleting(b)}>
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <BannerDialog banner={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Delete this banner?"
        description="It will be removed from the storefront immediately."
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync(deleting._id)}
      />
    </>
  )
}

const image = z.array(z.object({ media: z.string(), url: z.string() }))
const schema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  subtitle: z.string().trim().max(240).optional(),
  ctaLabel: z.string().trim().max(40).optional(),
  link: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^\/(?!\/)/.test(v) || /^https?:\/\//i.test(v), 'Use a path like /c/power-tools or a full https:// URL'),
  placement: z.enum(['home_hero', 'home_offer', 'home_strip']),
  image: image.min(1, 'Upload an image'),
  mobileImage: image,
  sortOrder: z.coerce.number().int().min(-1000).max(1000),
  status: z.enum(['active', 'inactive']),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
})

const toLocalInput = (d) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')

function BannerDialog({ banner, onClose }) {
  const qc = useQueryClient()
  const isNew = banner === 'new'
  const open = Boolean(banner)
  const form = useForm({ resolver: zodResolver(schema) })
  const placement = useWatch({ control: form.control, name: 'placement' })

  useEffect(() => {
    if (!open) return
    const b = isNew ? {} : banner
    form.reset({
      title: b.title ?? '',
      subtitle: b.subtitle ?? '',
      ctaLabel: b.ctaLabel ?? '',
      link: b.link ?? '',
      placement: b.placement ?? 'home_hero',
      image: b.image ? [b.image] : [],
      mobileImage: b.mobileImage ? [b.mobileImage] : [],
      sortOrder: b.sortOrder ?? 0,
      status: b.status ?? 'active',
      startsAt: toLocalInput(b.startsAt),
      endsAt: toLocalInput(b.endsAt),
    })
  }, [open, isNew, banner, form])

  const save = useMutation({
    mutationFn: ({ image: img, mobileImage, startsAt, endsAt, ...v }) => {
      const body = {
        ...v,
        image: { media: img[0].media },
        mobileImage: mobileImage[0] ? { media: mobileImage[0].media } : null,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      }
      return isNew ? adminApi.createBanner(body) : adminApi.updateBanner(banner._id, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.banners })
      toast.success(isNew ? 'Banner added' : 'Banner updated')
      onClose()
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })

  const { register, control, formState } = form
  const e = formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={isNew ? 'New banner' : 'Edit banner'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>
            {isNew ? 'Add banner' : 'Save'}
          </Button>
        </>
      }
    >
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => ev.preventDefault()}>
        <Field label="Placement" hint={PLACEMENTS.find((p) => p.value === placement)?.hint} className="sm:col-span-2">
          {(p) => (
            <Select {...p} {...register('placement')}>
              {PLACEMENTS.map((pl) => (
                <option key={pl.value} value={pl.value}>
                  {pl.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-slate-800">
            Image <span className="text-red-600">*</span>
          </p>
          <Controller
            name="image"
            control={control}
            render={({ field }) => (
              <ImageUploader audience="admin" folder="banners" max={1} aspect="aspect-[16/5]" value={field.value ?? []} onChange={field.onChange} compact />
            )}
          />
          {e.image && <p className="mt-1 text-xs font-medium text-red-600">{e.image.message}</p>}
        </div>
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-slate-800">Mobile image (optional)</p>
          <Controller
            name="mobileImage"
            control={control}
            render={({ field }) => (
              <ImageUploader audience="admin" folder="banners" max={1} aspect="aspect-[4/3]" value={field.value ?? []} onChange={field.onChange} compact />
            )}
          />
        </div>
        <Field label="Title" required error={e.title?.message} hint="Used as alt text and shown on the banner" className="sm:col-span-2">
          {(p) => <Input {...p} {...register('title')} />}
        </Field>
        <Field label="Subtitle" className="sm:col-span-2">
          {(p) => <Input {...p} {...register('subtitle')} />}
        </Field>
        <Field label="Link" error={e.link?.message} hint="e.g. /c/power-tools">
          {(p) => <Input {...p} {...register('link')} placeholder="/c/…" />}
        </Field>
        <Field label="Button label">{(p) => <Input {...p} {...register('ctaLabel')} placeholder="Shop now" />}</Field>
        <Field label="Starts">{(p) => <Input {...p} type="datetime-local" {...register('startsAt')} />}</Field>
        <Field label="Ends">{(p) => <Input {...p} type="datetime-local" {...register('endsAt')} />}</Field>
        <Field label="Status">
          {(p) => (
            <Select {...p} {...register('status')}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          )}
        </Field>
        <Field label="Sort order">{(p) => <Input {...p} type="number" {...register('sortOrder')} />}</Field>
      </form>
    </Dialog>
  )
}
