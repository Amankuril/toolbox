import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronRight, Package } from 'lucide-react'
import { Link } from 'react-router'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { formatDate, formatINR } from '@/core/lib/format'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, EmptyState, Skeleton } from '@/ui/Card'
import { Pagination } from '@/ui/DataTable'
import { storeKeys, userApi } from '../../api'

export default function MyOrdersPage() {
  const [f, setF] = useSearchParamsState()
  const params = { page: Number(f.page ?? 1), limit: 10 }
  const { data, isLoading } = useQuery({ queryKey: storeKeys.orders(params), queryFn: () => userApi.orders(params), placeholderData: keepPreviousData })

  return (
    <>
      <title>My orders</title>
      <h1 className="mb-5 text-2xl font-bold text-slate-900">My orders</h1>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data?.items.length ? (
        <Card>
          <EmptyState
            icon={Package}
            title="No orders yet"
            description="When you place an order, you can track it here."
            action={
              <Button asChild>
                <Link to="/">Start shopping</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {data.items.map((o) => (
            <Link key={o._id} to={`/account/orders/${o._id}`} className="block rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <span>
                    <span className="text-slate-500">Order </span>
                    <span className="font-semibold text-slate-900">{o.orderNumber}</span>
                  </span>
                  <span className="text-slate-500">Placed {formatDate(o.createdAt)}</span>
                  <span className="tabular font-semibold text-slate-900">{formatINR(o.amounts.total)}</span>
                </div>
                <StatusBadge status={o.status} />
              </div>
              <div className="flex items-center gap-4 px-5 py-4">
                <div className="flex -space-x-3">
                  {o.items.slice(0, 4).map((i) => (
                    <Thumb key={i._id} src={i.image} className="size-14 rounded-lg border-2 border-white shadow-sm" />
                  ))}
                </div>
                <p className="min-w-0 flex-1 truncate text-sm text-slate-700">
                  {o.items[0].name}
                  {o.items.length > 1 && <span className="text-slate-500"> + {o.items.length - 1} more</span>}
                </p>
                <ChevronRight className="size-5 text-slate-400" />
              </div>
            </Link>
          ))}
          <Pagination meta={data.meta} onPageChange={(page) => setF({ page })} />
        </div>
      )}
    </>
  )
}
