import { Outlet } from 'react-router'
import { SellerContext } from '@/modules/vendor/seller'
import { storeSeller } from './seller'

/** Everything under /admin/store runs the seller pages for the platform's own store. */
export default function StoreRoot() {
  return (
    <SellerContext.Provider value={storeSeller}>
      <Outlet />
    </SellerContext.Provider>
  )
}
