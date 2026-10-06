import { ShieldOff } from 'lucide-react'
import { Navigate, Outlet } from 'react-router'
import { Card, EmptyState } from '@/ui/Card'
import { useAdminAccess, useLanding } from './access'

/** Route guard for one section. */
export function RequireSection({ section }) {
  const { can, loaded } = useAdminAccess()
  const landing = useLanding()
  if (!loaded) return null
  if (can(section)) return <Outlet />
  if (section === 'dashboard' && landing && landing !== '/admin') return <Navigate to={landing} replace />
  return <NoAccess />
}

export function NoAccess() {
  const landing = useLanding()
  return (
    <Card>
      <EmptyState
        icon={ShieldOff}
        title="You don't have access to this section"
        description={landing ? 'Ask a super admin if you need it.' : 'No sections have been shared with you yet. Ask a super admin to give you access.'}
      />
    </Card>
  )
}
