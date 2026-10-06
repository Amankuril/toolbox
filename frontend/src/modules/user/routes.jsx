import { page } from '@/app/lazy'
import { RequireAuth } from '@/core/auth/RequireAuth'
import { ModuleRoot } from '@/modules/ModuleRoot'

export const userRoutes = {
  path: '/',
  element: <ModuleRoot module="user" />,
  children: [
    {
      ...page(() => import('./layout/StoreLayout')),
      children: [
        { index: true, ...page(() => import('./pages/HomePage')) },
        { path: 'c/:slug', ...page(() => import('./pages/CategoryPage')) },
        { path: 'search', ...page(() => import('./pages/SearchPage')) },
        { path: 'p/:slug', ...page(() => import('./pages/ProductPage')) },
        { path: 'store/:slug', ...page(() => import('./pages/StorePage')) },
        { path: 'cart', ...page(() => import('./pages/CartPage')) },
        { path: 'wishlist', ...page(() => import('./pages/WishlistPage')) },
        { path: 'login', ...page(() => import('./pages/LoginPage')) },
        { path: 'onboarding', ...page(() => import('./pages/OnboardingPage')) },
        {
          element: <RequireAuth audience="user" />,
          children: [
            { path: 'checkout', ...page(() => import('./pages/CheckoutPage')) },
            {
              path: 'account',
              ...page(() => import('./pages/account/AccountLayout')),
              children: [
                { index: true, ...page(() => import('./pages/account/OrdersPage')) },
                { path: 'orders', ...page(() => import('./pages/account/OrdersPage')) },
                { path: 'orders/:id', ...page(() => import('./pages/account/OrderDetailPage')) },
                { path: 'quotes', ...page(() => import('./pages/account/QuotesPage')) },
                { path: 'quotes/:id', ...page(() => import('./pages/account/QuoteDetailPage')) },
                { path: 'addresses', ...page(() => import('./pages/account/AddressesPage')) },
                { path: 'profile', ...page(() => import('./pages/account/ProfilePage')) },
              ],
            },
          ],
        },
        { path: '*', ...page(() => import('@/modules/admin/pages/NotFound')) },
      ],
    },
  ],
}
