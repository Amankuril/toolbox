import { createBrowserRouter } from 'react-router'
import { adminRoutes } from '@/modules/admin/routes'
import { userRoutes } from '@/modules/user/routes'
import { vendorRoutes } from '@/modules/vendor/routes'
import { RouteError } from './RouteError'

/**
 * Three modules, each lazily loaded so shoppers never download admin/vendor code:
 *   /         storefront (user)
 *   /vendor   seller panel
 *   /admin    admin panel
 */
export const router = createBrowserRouter([
  { ...adminRoutes, errorElement: <RouteError /> },
  { ...vendorRoutes, errorElement: <RouteError /> },
  { ...userRoutes, errorElement: <RouteError /> },
])
