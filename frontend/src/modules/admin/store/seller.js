import { useQuery } from '@tanstack/react-query'
import { api } from '@/core/api/http'
import { createSellerApi, createSellerKeys } from '@/modules/vendor/api'

/** The admin client scoped to /store: same calls as a seller makes, answered for the platform store. */
const scoped = (client, prefix) => ({
  get: (url, config) => client.get(prefix + url, config),
  delete: (url, config) => client.delete(prefix + url, config),
  post: (url, body, config) => client.post(prefix + url, body, config),
  put: (url, body, config) => client.put(prefix + url, body, config),
  patch: (url, body, config) => client.patch(prefix + url, body, config),
})

const storeKeys = createSellerKeys(['admin', 'store'])
const storeApi = createSellerApi(scoped(api.admin, '/store'))

/** The platform store's settings record (always approved). */
function useStoreAccount() {
  return useQuery({ queryKey: storeKeys.me, queryFn: storeApi.me, staleTime: 30_000 }).data
}

/** @type {import('@/modules/vendor/seller').Seller} */
export const storeSeller = {
  api: storeApi,
  keys: storeKeys,
  base: '/admin/store',
  audience: 'admin',
  uploadPath: '/store/media',
  isStore: true,
  useAccount: useStoreAccount,
}
