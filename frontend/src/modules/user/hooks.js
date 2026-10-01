import { useQuery } from '@tanstack/react-query'
import { storeApi, storeKeys } from './api'

export function useCategoryTree() {
  return useQuery({ queryKey: storeKeys.tree, queryFn: storeApi.categoryTree, staleTime: 5 * 60_000 })
}
