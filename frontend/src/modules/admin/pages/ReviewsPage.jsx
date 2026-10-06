import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Star } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDateTime, formatPhone } from '@/core/lib/format'
import { Stars } from '@/modules/user/components/Stars'
import { Badge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { ReasonDialog } from '@/ui/ReasonDialog'
import { adminApi, adminKeys } from '../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'published', label: 'Published' },
  { value: 'hidden', label: 'Hidden' },
]

/** Verified-purchase reviews across the store; admins can hide abusive or off-topic ones. */
export default function ReviewsPage() {
  const qc = useQueryClient()
  const [filters, setFilters] = useSearchParamsState()
  const params = { page: Number(filters.page ?? 1), limit: 20, status: filters.status || undefined, rating: filters.rating || undefined }
  const { data, isLoading } = useQuery({ queryKey: adminKeys.reviews(params), queryFn: () => adminApi.reviews(params), placeholderData: keepPreviousData })
  const moderate = useMutation({
    mutationFn: ({ id, status, note }) => adminApi.moderateReview(id, { status, note }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin', 'reviews'] })
      toast.success(v.status === 'hidden' ? 'Review hidden from the store' : 'Review published')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <>
      <PageHeader title="Reviews" description="Every review comes from a customer whose order was delivered. Hide ones that break the rules." />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-2">
          <FilterTabs value={filters.status ?? ''} onChange={(status) => setFilters({ status, page: undefined })} options={TABS} />
          <Select value={filters.rating ?? ''} onChange={(e) => setFilters({ rating: e.target.value, page: undefined })} className="mb-2 w-auto">
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} star{n === 1 ? '' : 's'}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items ?? []}
          empty={{ title: 'No reviews yet', description: 'Customers can review products once their order is delivered.' }}
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (r) =>
                r.product ? (
                  <div className="flex max-w-64 items-center gap-3">
                    <Thumb src={r.product.image?.url} className="size-10 shrink-0 rounded-sm" />
                    <Link to={`/p/${r.product.slug}`} target="_blank" className="line-clamp-2 font-semibold text-slate-900 hover:underline">
                      {r.product.name}
                    </Link>
                  </div>
                ) : (
                  '—'
                ),
            },
            {
              key: 'review',
              header: 'Review',
              cell: (r) => (
                <div className="flex max-w-md flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <Stars value={r.rating} size={14} />
                    {r.title && <span className="font-semibold text-slate-900">{r.title}</span>}
                  </span>
                  {r.body && <span className="line-clamp-3 text-sm text-slate-600">{r.body}</span>}
                  {r.moderation?.note && <span className="text-xs text-red-700">Hidden: {r.moderation.note}</span>}
                </div>
              ),
            },
            {
              key: 'customer',
              header: 'Customer',
              cell: (r) => (
                <div className="text-sm">
                  <p className="font-medium text-slate-900">{r.user?.name ?? '—'}</p>
                  <p className="text-xs text-slate-500">{formatPhone(r.user?.phone)}</p>
                </div>
              ),
            },
            { key: 'date', header: 'Posted', cell: (r) => <span className="text-sm whitespace-nowrap text-slate-600">{formatDateTime(r.createdAt)}</span> },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => (
                <Badge tone={r.status === 'hidden' ? 'danger' : 'success'} dot>
                  {r.status === 'hidden' ? 'Hidden' : 'Published'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              className: 'w-px text-right',
              cell: (r) =>
                r.status === 'hidden' ? (
                  <Button size="sm" variant="outline" onClick={() => moderate.mutate({ id: r._id, status: 'published' })}>
                    <Eye /> Publish
                  </Button>
                ) : (
                  <ReasonDialog
                    title="Hide this review?"
                    description="It disappears from the product page and stops counting towards the rating."
                    label="Reason (kept for your records)"
                    required={false}
                    confirmLabel="Hide review"
                    onSubmit={(note) => moderate.mutateAsync({ id: r._id, status: 'hidden', note: note || undefined })}
                    trigger={
                      <Button size="sm" variant="ghost" className="text-red-700 hover:bg-red-50">
                        <EyeOff /> Hide
                      </Button>
                    }
                  />
                ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} />
      </Card>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <Star className="size-3.5" /> Product ratings update as soon as a review is hidden or published.
      </p>
    </>
  )
}
