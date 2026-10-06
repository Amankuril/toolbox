import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronRight, FileText } from 'lucide-react'
import { Link } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatINR, formatNumber } from '@/core/lib/format'
import { unitPlural } from '@/core/lib/units'
import { QuoteStatus } from '@/modules/shared/quotes'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { FilterTabs } from '@/ui/Controls'
import { Pagination } from '@/ui/DataTable'
import { storeKeys, userApi } from '../../api'

const TABS = [
  { value: '', label: 'All' },
  { value: 'quoted', label: 'Offers to review' },
  { value: 'requested', label: 'Waiting for seller' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'ordered', label: 'Ordered' },
]

export default function MyQuotesPage() {
  const [f, setF] = useSearchParamsState()
  const params = { page: Number(f.page ?? 1), limit: 10, status: f.status || undefined }
  const { data, isLoading } = useQuery({ queryKey: storeKeys.quotes(params), queryFn: () => userApi.quotes(params), placeholderData: keepPreviousData })

  return (
    <>
      <title>Bulk quotes</title>
      <h1 className="font-display text-3xl font-bold text-slate-900">Bulk quotes</h1>
      <p className="mt-1 text-sm text-slate-500">Request a quote from any product page when you need a large quantity.</p>
      <div className="mt-5">
        <FilterTabs value={f.status ?? ''} onChange={(status) => setF({ status })} options={TABS} counts={data?.meta?.counts} />
      </div>
      {isLoading ? (
        <Skeleton className="mt-6 h-48" />
      ) : !data?.items.length ? (
        <EmptyState
          icon={FileText}
          title={f.status ? 'Nothing here' : 'No quote requests yet'}
          description="Look for “Request a quote” on product pages for large quantities."
          action={
            !f.status && (
              <Button asChild>
                <Link to="/search?bulk=true">Browse bulk deals</Link>
              </Button>
            )
          }
        />
      ) : (
        <ul className="mt-2 divide-y divide-slate-200">
          {data.items.map((q) => (
            <li key={q._id}>
              <Link to={`/account/quotes/${q._id}`} className="flex items-center gap-4 py-4 hover:bg-slate-50 sm:px-2">
                <Thumb src={q.product.image} className="size-16 shrink-0 rounded bg-slate-100" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{q.product.name}</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    {formatNumber(q.quantity)} {unitPlural(q.product.unit, q.quantity)}
                    {q.offer && (
                      <>
                        {' '}
                        · offer <strong className="text-slate-900">{formatINR(q.offer.unitPrice)}</strong>/unit
                      </>
                    )}
                    <span className="text-slate-400"> · {q.vendor?.store?.name ?? 'Seller'}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {q.number} · {formatDate(q.createdAt)}
                  </p>
                </div>
                <QuoteStatus status={q.status} />
                <ChevronRight className="size-5 text-slate-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Pagination meta={data?.meta} onPageChange={(page) => setF({ page })} />
    </>
  )
}
