import { useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { safeNext } from '@/core/auth/bootstrap'
import { useSession } from '@/core/auth/session'
import { useBranding } from '@/core/settings/usePublicSettings'
import { OtpSignIn } from '@/modules/auth/OtpSignIn'
import { Card } from '@/ui/Card'
import { mergeGuestCart } from '../cart/useCart'

export default function UserLoginPage() {
  const status = useSession('user', (s) => s.status)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { siteName } = useBranding()
  const next = safeNext(params.get('next'), '/')

  if (status === 'authenticated') return <Navigate to={next} replace />

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-12">
      <title>{`Sign in | ${siteName}`}</title>
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Sign in or create an account</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">Use your mobile number or email. New here? We&apos;ll set up your account after you verify.</p>
        <OtpSignIn
          audience="user"
          onAuthenticated={async () => {
            await mergeGuestCart(qc)
            navigate(next, { replace: true })
          }}
          onOnboarding={(state) => navigate('/onboarding', { state: { ...state, next }, replace: true })}
        />
      </Card>
    </div>
  )
}
