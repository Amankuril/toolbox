import { page } from '@/app/lazy'
import { RequireAuth } from '@/core/auth/RequireAuth'
import { ModuleRoot } from '@/modules/ModuleRoot'

export const vendorRoutes = {
  path: '/vendor',
  element: <ModuleRoot module="vendor" />,
  children: [
    { path: 'login', ...page(() => import('./pages/LoginPage')) },
    { path: 'register', ...page(() => import('./pages/RegisterPage')) },
    {
      element: <RequireAuth audience="vendor" />,
      children: [
        { path: 'onboarding', ...page(() => import('./pages/OnboardingPage')) },
        {
          ...page(() => import('./VendorLayout')),
          children: [
            { index: true, ...page(() => import('./pages/DashboardPage')) },
            { path: 'products', ...page(() => import('./pages/ProductsPage')) },
            { path: 'products/import', ...page(() => import('./pages/ProductImportPage')) },
            { path: 'products/new', ...page(() => import('./pages/ProductFormPage')) },
            { path: 'products/:id', ...page(() => import('./pages/ProductFormPage')) },
            { path: 'categories', ...page(() => import('./pages/CategoriesPage')) },
            { path: 'quotes', ...page(() => import('./pages/QuotesPage')) },
            { path: 'quotes/:id', ...page(() => import('./pages/QuoteDetailPage')) },
            { path: 'orders', ...page(() => import('./pages/OrdersPage')) },
            { path: 'orders/:id', ...page(() => import('./pages/OrderDetailPage')) },
            { path: 'leads', ...page(() => import('./pages/LeadsPage')) },
            { path: 'leads/:userId', ...page(() => import('./pages/LeadDetailPage')) },
            { path: 'coupons', ...page(() => import('./pages/CouponsPage')) },
            { path: 'profile', ...page(() => import('./pages/ProfilePage')) },
            { path: '*', ...page(() => import('@/modules/admin/pages/NotFound')) },
          ],
        },
      ],
    },
  ],
}
