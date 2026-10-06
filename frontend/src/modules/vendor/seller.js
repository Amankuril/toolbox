import { createContext, useContext } from 'react'
import { useVendor, vendorApi, vendorKeys } from './api'

/**
 * Which seller the seller pages are working for. The vendor panel uses the signed-in seller;
 * the admin panel's "Our store" provides the platform store (see modules/admin/store).
 *
 * @typedef {{ api: ReturnType<import('./api').createSellerApi>, keys: ReturnType<import('./api').createSellerKeys>,
 *   base: string, audience: 'vendor'|'admin', uploadPath: string, isStore: boolean, useAccount: () => any }} Seller
 */
export const vendorSeller = {
  api: vendorApi,
  keys: vendorKeys,
  base: '/vendor',
  audience: 'vendor',
  uploadPath: '/media',
  isStore: false,
  useAccount: useVendor,
}

export const SellerContext = createContext(vendorSeller)

/** @returns {Seller} */
export const useSeller = () => useContext(SellerContext)
