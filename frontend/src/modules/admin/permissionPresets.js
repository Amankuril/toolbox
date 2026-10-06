import { SECTIONS } from './access'

const all = (level) => Object.fromEntries(SECTIONS.map((s) => [s.key, level]))

/** Starting points for common jobs; every row can still be adjusted. */
export const PRESETS = [
  { label: 'Customer support', value: { ...all('none'), orders: 'manage', customers: 'view', quotes: 'view', reviews: 'manage' } },
  { label: 'Catalogue manager', value: { ...all('none'), products: 'manage', categories: 'manage', vendors: 'view', banners: 'manage', media: 'manage' } },
  { label: 'Store manager', value: { ...all('none'), store: 'manage', categories: 'view' } },
  { label: 'Seller onboarding', value: { ...all('none'), vendors: 'manage', products: 'manage', categories: 'view' } },
  { label: 'View everything', value: all('view') },
  { label: 'Manage everything', value: all('manage') },
]

export const emptyPermissions = () => all('none')

/** Readable one-line summary for the admins table. */
export function summarize(admin) {
  if (admin.adminRole === 'super_admin') return 'Everything, including admins'
  if (admin.fullAccess) return 'Full access (set before permissions)'
  const open = SECTIONS.filter((s) => admin.permissions?.[s.key] !== 'none')
  if (!open.length) return 'No access yet'
  return open.map((s) => `${s.label}${admin.permissions[s.key] === 'view' ? ' (view)' : ''}`).join(', ')
}
