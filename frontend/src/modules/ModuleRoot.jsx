import { Outlet } from 'react-router'
import { useModuleTheme } from '@/core/settings/usePublicSettings'

/** Applies the admin-configured theme for a module (user / vendor / admin) to everything below it. */
export function ModuleRoot({ module }) {
  useModuleTheme(module)
  return <Outlet />
}
