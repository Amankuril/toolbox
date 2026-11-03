import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { one, api } from '@/core/api/http'
import { flattenTree } from '@/core/lib/tree'
import { AnalyticsReport } from '@/modules/shared/analytics/AnalyticsReport'
import { adminApi, adminKeys } from '../api'

/** Marketplace analytics: every seller together, or one of them, with the same filters sellers get. */
export default function AdminAnalyticsPage() {
  const { data: tree } = useQuery({ queryKey: adminKeys.categoryTree, queryFn: adminApi.categoryTree, staleTime: 5 * 60_000 })
  const { data: vendorList } = useQuery({
    queryKey: adminKeys.vendors({ status: 'approved', limit: 100, analytics: true }),
    queryFn: () => adminApi.vendors({ status: 'approved', limit: 100 }),
    staleTime: 5 * 60_000,
  })
  const categories = useMemo(() => flattenTree(tree ?? []), [tree])
  const vendors = useMemo(
    () =>
      (vendorList?.items ?? [])
        .map((v) => ({ value: v._id, label: v.store?.name ?? v.legalName ?? 'Unnamed store' }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [vendorList],
  )
  return (
    <AnalyticsReport
      title="Analytics"
      description="The whole marketplace: sales, customers, sellers and storefront visits, with filters."
      queryKey={['admin', 'analytics']}
      fetch={(params) => one(api.admin.get('/analytics', { params }))}
      categories={categories}
      vendors={vendors}
    />
  )
}
