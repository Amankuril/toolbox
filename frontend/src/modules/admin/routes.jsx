import { page } from '@/app/lazy'
import { RequireAuth } from '@/core/auth/RequireAuth'
import { ModuleRoot } from '@/modules/ModuleRoot'

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
          children: [
            { index: true, ...page(() => import('./pages/DashboardPage')) },
            { path: 'orders', ...page(() => import('./pages/OrdersPage')) },
            { path: 'orders/:id', ...page(() => import('./pages/OrderDetailPage')) },
            { path: 'quotes', ...page(() => import('./pages/QuotesPage')) },
            { path: 'products', ...page(() => import('./pages/ProductsPage')) },
            { path: 'products/:id', ...page(() => import('./pages/ProductDetailPage')) },
            { path: 'categories', ...page(() => import('./pages/CategoriesPage')) },
            { path: 'vendors', ...page(() => import('./pages/VendorsPage')) },
            { path: 'vendors/:id', ...page(() => import('./pages/VendorDetailPage')) },
            { path: 'customers', ...page(() => import('./pages/CustomersPage')) },
            { path: 'banners', ...page(() => import('./pages/BannersPage')) },
            { path: 'settings', ...page(() => import('./pages/SettingsPage')) },
            { path: 'admins', ...page(() => import('./pages/AdminsPage')) },
            { path: 'account', ...page(() => import('./pages/AccountPage')) },
            { path: '*', ...page(() => import('./pages/NotFound')) },
          ],
        },
      ],
    },
  ],
}
