import { page } from '@/app/lazy'
import { RequireAuth } from '@/core/auth/RequireAuth'
import { ModuleRoot } from '@/modules/ModuleRoot'
import { RequireSection } from './AccessGuard'

export const adminRoutes = {
  path: '/admin',
  element: <ModuleRoot module="admin" />,
  children: [
    { path: 'login', ...page(() => import('./pages/LoginPage')) },
    {
      element: <RequireAuth audience="admin" />,
      children: [
        {
          ...page(() => import('./AdminLayout')),
          // Each group is visible only to admins with access to that section (see access.jsx).
          children: [
            { element: <RequireSection section="dashboard" />, children: [{ index: true, ...page(() => import('./pages/DashboardPage')) }] },
            {
              element: <RequireSection section="orders" />,
              children: [
                { path: 'orders', ...page(() => import('./pages/OrdersPage')) },
                { path: 'orders/:id', ...page(() => import('./pages/OrderDetailPage')) },
              ],
            },
            { element: <RequireSection section="quotes" />, children: [{ path: 'quotes', ...page(() => import('./pages/QuotesPage')) }] },
            { element: <RequireSection section="reviews" />, children: [{ path: 'reviews', ...page(() => import('./pages/ReviewsPage')) }] },
            {
              element: <RequireSection section="products" />,
              children: [
                { path: 'products', ...page(() => import('./pages/ProductsPage')) },
                { path: 'products/import', ...page(() => import('./pages/ProductImportPage')) },
                { path: 'products/:id', ...page(() => import('./pages/ProductDetailPage')) },
              ],
            },
            {
              // The platform's own store: the seller pages, run for the house store (see store/seller.js).
              element: <RequireSection section="store" />,
              children: [
                {
                  path: 'store',
                  ...page(() => import('./store/StoreRoot')),
                  children: [
                    { index: true, ...page(() => import('@/modules/vendor/pages/DashboardPage')) },
                    { path: 'products', ...page(() => import('@/modules/vendor/pages/ProductsPage')) },
                    { path: 'products/import', ...page(() => import('@/modules/vendor/pages/ProductImportPage')) },
                    { path: 'products/new', ...page(() => import('@/modules/vendor/pages/ProductFormPage')) },
                    { path: 'products/:id', ...page(() => import('@/modules/vendor/pages/ProductFormPage')) },
                    { path: 'orders', ...page(() => import('@/modules/vendor/pages/OrdersPage')) },
                    { path: 'orders/:id', ...page(() => import('@/modules/vendor/pages/OrderDetailPage')) },
                    { path: 'quotes', ...page(() => import('@/modules/vendor/pages/QuotesPage')) },
                    { path: 'quotes/:id', ...page(() => import('@/modules/vendor/pages/QuoteDetailPage')) },
                    { path: 'settings', ...page(() => import('./store/StoreSettingsPage')) },
                  ],
                },
              ],
            },
            { element: <RequireSection section="categories" />, children: [{ path: 'categories', ...page(() => import('./pages/CategoriesPage')) }] },
            {
              element: <RequireSection section="vendors" />,
              children: [
                { path: 'vendors', ...page(() => import('./pages/VendorsPage')) },
                { path: 'vendors/:id', ...page(() => import('./pages/VendorDetailPage')) },
              ],
            },
            { element: <RequireSection section="customers" />, children: [{ path: 'customers', ...page(() => import('./pages/CustomersPage')) }] },
            { element: <RequireSection section="banners" />, children: [{ path: 'banners', ...page(() => import('./pages/BannersPage')) }] },
            { element: <RequireSection section="settings" />, children: [{ path: 'settings', ...page(() => import('./pages/SettingsPage')) }] },
            { path: 'admins', ...page(() => import('./pages/AdminsPage')) },
            { path: 'account', ...page(() => import('./pages/AccountPage')) },
            { path: '*', ...page(() => import('./pages/NotFound')) },
          ],
        },
      ],
    },
  ],
}
