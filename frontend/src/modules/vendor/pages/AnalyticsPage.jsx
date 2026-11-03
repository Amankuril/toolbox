import { useMemo } from 'react'
import { buildTree, flattenTree } from '@/core/lib/tree'
import { AnalyticsReport } from '@/modules/shared/analytics/AnalyticsReport'
import { useVendorCategories } from '../components/categoryOptions'
import { useSeller } from '../seller'

/** Store analytics: sales, orders, customers and storefront visits for this seller (or the house store). */
export default function AnalyticsPage() {
  const seller = useSeller()
  const { data: rows } = useVendorCategories()
  const categories = useMemo(() => flattenTree(buildTree((rows ?? []).filter((c) => c.status === 'active'))), [rows])
  return (
    <AnalyticsReport
      title="Store analytics"
      description="How your store is doing: sales, orders, customers, and who visits your store and product pages."
      queryKey={[...seller.keys.all, 'analytics']}
      fetch={seller.api.analytics}
      categories={categories}
    />
  )
}
