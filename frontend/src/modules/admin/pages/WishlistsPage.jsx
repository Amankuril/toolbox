import { WishlistsPage } from '@/modules/shared/Wishlists'
import { adminApi, adminKeys } from '../api'

const client = { root: adminKeys.all, list: adminApi.wishlists, remind: adminApi.remindWishlists }

export default function AdminWishlistsPage() {
  return <WishlistsPage client={client} showSeller />
}
