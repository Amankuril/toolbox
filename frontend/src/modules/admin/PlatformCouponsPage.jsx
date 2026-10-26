import CouponsPage from '@/modules/vendor/pages/CouponsPage'
import { SellerContext } from '@/modules/vendor/seller'
import { platformCouponApi } from './api'

const root = ['admin', 'platform-coupons']

/** Platform coupons: the seller coupon page, for codes that work on every seller's products. */
const platformCoupons = {
  api: platformCouponApi,
  keys: { all: root, coupons: (p) => [...root, 'coupons', p] },
  base: '/admin',
  audience: 'admin',
  platform: true,
  isStore: true,
  useAccount: () => undefined,
}

export default function PlatformCouponsPage() {
  return (
    <SellerContext.Provider value={platformCoupons}>
      <CouponsPage />
    </SellerContext.Provider>
  )
}
