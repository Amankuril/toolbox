import { WishlistsPage } from '@/modules/shared/Wishlists'
import { useSeller } from '../seller'

export default function SellerWishlistsPage() {
  const seller = useSeller()
  return <WishlistsPage client={{ root: seller.keys.all, list: seller.api.wishlists, remind: seller.api.remindWishlists }} />
}
