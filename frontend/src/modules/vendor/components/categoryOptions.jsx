import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { buildTree, flattenTree } from '@/core/lib/tree'
import { vendorApi, vendorKeys } from '../api'

export function useVendorCategories() {
  return useQuery({ queryKey: vendorKeys.categories, queryFn: vendorApi.categories, staleTime: 60_000 })
}

/** Category rows as combobox options, depth-first with full paths. */
export function useCategoryOptions({ maxLevel = 2, excludeId } = {}) {
  const { data = [] } = useVendorCategories()
  return useMemo(
    () =>
      flattenTree(buildTree(data.filter((c) => c.status !== 'rejected')))
        .filter((c) => c.level <= maxLevel && c._id !== excludeId)
        .map((c) => ({
          value: c._id,
          label: c.name,
          description: c.path,
          depth: c.depth,
          badge: c.status === 'pending' ? <span className="rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-700">Pending</span> : null,
        })),
    [data, maxLevel, excludeId],
  )
}
