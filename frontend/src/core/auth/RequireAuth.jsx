import { Navigate, Outlet, useLocation } from 'react-router'
import { LOGIN_PATHS } from '@/core/config'
import { FullPageLoader } from '@/ui/Spinner'
import { useSessionBootstrap } from './bootstrap'

/** Route guard: renders children once signed in, otherwise redirects to the audience's login page. */
export function RequireAuth({ audience, children }) {
  const status = useSessionBootstrap(audience, { always: audience !== 'user' })
  const location = useLocation()

  if (status === 'idle' || status === 'checking') return <FullPageLoader />
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`${LOGIN_PATHS[audience]}?next=${encodeURIComponent(next)}`} replace />
  }
  return children ?? <Outlet />
}
