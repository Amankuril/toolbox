import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Camera, ChevronLeft, ChevronRight, PencilLine, Star, X } from 'lucide-react'
import { Dialog as RDialog } from 'radix-ui'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { cn } from '@/core/lib/cn'
import { formatNumber } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { storeApi, storeKeys, userApi } from '../api'
import { SectionHeading } from './ProductCard'
import { Stars } from './Stars'

const PAGE = 5
const monthYear = (d) => new Date(d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
const SORTS = [
  ['recent', 'Most recent'],
  ['highest', 'Highest rated'],
  ['lowest', 'Lowest rated'],
]

/**
 * Verified-purchase reviews: summary with a star breakdown (each bar filters the list),
 * newest first, and a write/edit dialog for customers who received the item.
 */
export function Reviews({ product }) {
  const signedIn = useSession('user', (s) => s.status === 'authenticated')
  const [limit, setLimit] = useState(PAGE)
  const [sort, setSort] = useState('recent')
  const [rating, setRating] = useState(null)
  const [withImages, setWithImages] = useState(false)
  const [viewer, setViewer] = useState(null)
  const params = { page: 1, limit, sort, ...(rating ? { rating } : {}), ...(withImages ? { withImages: true } : {}) }
  const { data, isLoading } = useQuery({
    queryKey: storeKeys.reviews(product._id, params),
    queryFn: () => storeApi.reviews(product._id, params),
    placeholderData: (prev) => prev,
  })
  const { data: mine } = useQuery({ queryKey: storeKeys.myReview(product._id), queryFn: () => userApi.myReview(product._id), enabled: signedIn })

  const summary = data?.summary ?? { average: 0, count: 0, breakdown: [0, 0, 0, 0, 0] }
  const items = data?.items ?? []
  const photos = data?.photos ?? []
  const total = data?.meta?.total ?? 0

  const action = mine?.review ? (
    <ReviewDialog
      product={product}
      existing={mine.review}
      trigger={
        <Button variant="outline" size="sm">
          <PencilLine /> Edit your review
        </Button>
      }
    />
  ) : mine?.canReview ? (
    <ReviewDialog
      product={product}
      trigger={
        <Button variant="strong" size="sm">
          Write a review
        </Button>
      }
    />
  ) : null

  return (
    <section id="reviews" className="mt-12 scroll-mt-28">
      <SectionHeading title={`Reviews & ratings${summary.count ? ` (${formatNumber(summary.count)})` : ''}`} action={action} />

      {!isLoading && summary.count === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-6">
          <Stars value={0} size={20} />
          <p className="font-semibold text-slate-900">No reviews yet</p>
          <p className="text-sm text-slate-600">
            {mine?.canReview ? (
              'You bought this. Tell other buyers how it held up.'
            ) : signedIn ? (
              'Reviews come from customers who received this item.'
            ) : (
              <>
                Bought this?{' '}
                <Link to="/login" className="font-semibold text-primary underline">
                  Sign in
                </Link>{' '}
                to review it.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="flex flex-col gap-5 lg:sticky lg:top-28 lg:self-start">
            <div className="flex items-end gap-4">
              <span className="price text-[3.5rem] leading-none text-slate-900">{summary.average.toFixed(1)}</span>
              <span className="flex flex-col gap-1.5 pb-1.5">
                <Stars value={summary.average} size={20} />
                <span className="text-sm text-slate-600">
                  {formatNumber(summary.count)} verified {summary.count === 1 ? 'review' : 'reviews'}
                </span>
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {[5, 4, 3, 2, 1].map((stars) => {
                const n = summary.breakdown[stars - 1] ?? 0
                const pct = summary.count ? Math.round((n / summary.count) * 100) : 0
                const active = rating === stars
                return (
                  <li key={stars}>
                    <button
                      type="button"
                      disabled={!n}
                      aria-pressed={active}
                      onClick={() => (setRating(active ? null : stars), setLimit(PAGE))}
                      className={cn(
                        'grid w-full grid-cols-[2.5rem_1fr_2.5rem] items-center gap-3 rounded-sm px-1.5 py-1 text-sm transition-colors enabled:hover:bg-slate-100 disabled:cursor-default',
                        active && 'bg-slate-100 ring-1 ring-slate-300',
                      )}
                    >
                      <span className="flex items-center gap-1 font-semibold text-slate-800">
                        {stars} <Star className="size-3.5 fill-current text-amber-500" strokeWidth={0} />
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-slate-200">
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="tabular text-right text-xs text-slate-600">{formatNumber(n)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {rating && (
              <button type="button" onClick={() => setRating(null)} className="self-start text-sm font-semibold text-primary underline">
                Show all ratings
              </button>
            )}
          </div>

          <div className="min-w-0">
            {photos.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Camera className="size-4" strokeWidth={1.8} /> Customer photos
                </p>
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((ph, i) => (
                    <li key={`${ph.review}-${i}`} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setViewer({ images: photos, index: i })}
                        className="block size-20 overflow-hidden rounded-md border border-slate-200 bg-slate-100 sm:size-24"
                        aria-label={`Customer photo ${i + 1} of ${photos.length}`}
                      >
                        <img src={ph.url} alt={ph.alt ?? ''} loading="lazy" className="size-full object-cover transition-transform hover:scale-105" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                {rating
                  ? `${formatNumber(total)} with ${rating} star${rating === 1 ? '' : 's'}`
                  : `Showing ${Math.min(items.length, total)} of ${formatNumber(total)}`}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {photos.length > 0 && (
                  <button
                    type="button"
                    aria-pressed={withImages}
                    onClick={() => (setWithImages((v) => !v), setLimit(PAGE))}
                    className={cn(
                      'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold transition-colors',
                      withImages ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500',
                    )}
                  >
                    <Camera className="size-4" strokeWidth={1.8} /> With photos
                  </button>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-slate-600">Sort</span>
                  <select
                    value={sort}
                    onChange={(e) => (setSort(e.target.value), setLimit(PAGE))}
                    className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-semibold"
                  >
                    {SORTS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <ul>
              {items.map((r) => (
                <li key={r._id} className="flex flex-col gap-2 border-b border-dashed border-slate-300 py-5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Stars value={r.rating} size={16} />
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <BadgeCheck className="size-4" strokeWidth={1.8} />
                      Verified purchase{r.purchasedAt ? ` · ${monthYear(r.purchasedAt)}` : ''}
                    </span>
                  </div>
                  {r.title && <p className="font-bold text-slate-900">{r.title}</p>}
                  {r.body && <p className="text-[0.9375rem] leading-relaxed whitespace-pre-line text-slate-700">{r.body}</p>}
                  {r.images?.length > 0 && (
                    <ul className="flex flex-wrap gap-2 pt-1">
                      {r.images.map((img, i) => (
                        <li key={img.url}>
                          <button
                            type="button"
                            onClick={() => setViewer({ images: r.images, index: i })}
                            className="block size-16 overflow-hidden rounded-md border border-slate-200 bg-slate-100 sm:size-20"
                            aria-label={`Photo ${i + 1} from ${r.author}`}
                          >
                            <img src={img.url} alt={img.alt ?? ''} loading="lazy" className="size-full object-cover" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-slate-500">{r.author}</p>
                </li>
              ))}
            </ul>
            {items.length < total && (
              <Button variant="outline" className="mt-2" onClick={() => setLimit((n) => n + PAGE * 2)}>
                Show more reviews
              </Button>
            )}
          </div>
        </div>
      )}
      <PhotoViewer viewer={viewer} onClose={() => setViewer(null)} onIndex={(index) => setViewer((v) => ({ ...v, index }))} />
    </section>
  )
}

/** Full-size photo with prev/next; arrow keys work while open. */
function PhotoViewer({ viewer, onClose, onIndex }) {
  const n = viewer?.images.length ?? 0
  const img = viewer?.images[viewer.index]
  const go = (d) => onIndex((viewer.index + d + n) % n)
  return (
    <RDialog.Root open={Boolean(viewer)} onOpenChange={(o) => !o && onClose()}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/85" />
        <RDialog.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none sm:p-12"
          onKeyDown={(e) => {
            if (n < 2) return
            if (e.key === 'ArrowLeft') go(-1)
            if (e.key === 'ArrowRight') go(1)
          }}
        >
          <RDialog.Title className="sr-only">Customer photo</RDialog.Title>
          <RDialog.Description className="sr-only">{n > 1 ? `Photo ${viewer.index + 1} of ${n}` : 'Photo'}</RDialog.Description>
          {img && <img src={img.url} alt={img.alt ?? ''} className="max-h-full max-w-full rounded-md object-contain" />}
          <RDialog.Close
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close"
          >
            <X className="size-5" />
          </RDialog.Close>
          {n > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label="Previous photo"
                className="absolute left-3 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label="Next photo"
                className="absolute right-3 grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <ChevronRight className="size-5" />
              </button>
              <span className="code absolute bottom-4 text-xs tracking-widest text-white/70">
                {viewer.index + 1} / {n}
              </span>
            </>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

const LABELS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']
const MAX_PHOTOS = 5

function ReviewDialog({ product, existing, trigger }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    rating: existing?.rating ?? 0,
    title: existing?.title ?? '',
    body: existing?.body ?? '',
    images: (existing?.images ?? []).map((i) => ({ media: i.media, url: i.url })),
  })
  const [hover, setHover] = useState(0)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['public', 'reviews', product._id] })
    qc.invalidateQueries({ queryKey: storeKeys.myReview(product._id) })
    qc.invalidateQueries({ queryKey: storeKeys.product(product.slug) })
  }
  const save = useMutation({
    mutationFn: () =>
      userApi.saveReview(product._id, {
        rating: form.rating,
        title: form.title.trim() || undefined,
        body: form.body.trim() || undefined,
        images: form.images.map((i) => ({ media: i.media })),
      }),
    onSuccess: () => {
      refresh()
      setOpen(false)
      toast.success(existing ? 'Review updated' : 'Thanks for your review')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const remove = useMutation({
    mutationFn: () => userApi.deleteReview(product._id),
    onSuccess: () => {
      refresh()
      setOpen(false)
      toast.success('Review deleted')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const shown = hover || form.rating

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      title={existing ? 'Edit your review' : 'Write a review'}
      description={product.name}
      footer={
        <>
          {existing && (
            <Button variant="ghost" className="mr-auto text-red-700 hover:bg-red-50" loading={remove.isPending} onClick={() => remove.mutate()}>
              Delete review
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!form.rating} loading={save.isPending} onClick={() => save.mutate()}>
            {existing ? 'Save changes' : 'Post review'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold text-slate-900">Your rating</legend>
          <div className="flex items-center gap-3" onMouseLeave={() => setHover(0)}>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  aria-pressed={form.rating === n}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setForm({ ...form, rating: n })}
                  className="grid size-11 place-items-center rounded-md hover:bg-amber-50"
                >
                  <Star className={cn('size-7', n <= shown ? 'fill-amber-500 text-amber-500' : 'text-slate-300')} strokeWidth={n <= shown ? 0 : 1.6} />
                </button>
              ))}
            </div>
            <span className="text-sm font-semibold text-slate-700">{LABELS[shown]}</span>
          </div>
        </fieldset>
        <Field label="Headline" hint="Optional">
          {(p) => (
            <Input
              {...p}
              maxLength={120}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Sturdy, easy to wheel around"
            />
          )}
        </Field>
        <Field label="Your review" hint="Optional. How did it perform, and for what job?">
          {(p) => <Textarea {...p} rows={5} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-slate-900">
            Add photos <span className="font-normal text-slate-500">· Optional, up to {MAX_PHOTOS}</span>
          </p>
          <ImageUploader
            audience="user"
            folder="reviews"
            max={MAX_PHOTOS}
            cover={false}
            compact
            label="Add photo"
            gridClassName="grid-cols-3 sm:grid-cols-5"
            value={form.images}
            onChange={(images) => setForm((f) => ({ ...f, images }))}
          />
          <p className="text-xs text-slate-500">Show the product in use: the build, the finish, the job it did.</p>
        </div>
        <p className="text-xs text-slate-500">Your review shows your first name and last initial, marked as a verified purchase.</p>
      </div>
    </Dialog>
  )
}
