import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Store } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { one, publicApi } from '@/core/api/http'
import { applyFieldErrors, parseApiError } from '@/core/api/errors'
import { sessions } from '@/core/auth/session'
import { formatPhone } from '@/core/lib/format'
import { email, required } from '@/core/lib/validators'
import { Logo } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { Field, Input } from '@/ui/Field'

const schema = z.object({ contactName: required('Your name', 120), email, storeName: required('Store name', 120) })

/** Step after OTP for a new seller: just enough to create the account. The rest happens in the setup wizard. */
export default function VendorRegisterPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { contactName: '', email: '', storeName: '' } })
  const createAccount = useMutation({
    mutationFn: (body) => one(publicApi.post('/auth/vendor/register', { ...body, onboardingToken: state.onboardingToken })),
    onSuccess: (data) => {
      sessions.vendor.getState().signIn(data)
      navigate('/vendor/onboarding', { replace: true })
    },
    onError: (err) => applyFieldErrors(err, form.setError),
  })

  if (!state?.onboardingToken) return <Navigate to="/vendor/login" replace />

  const error = createAccount.error && parseApiError(createAccount.error)
  const expired = error?.code === 'ONBOARDING_TOKEN_INVALID'
  const e = form.formState.errors

  return (
    <div className="flex min-h-dvh flex-col items-center bg-slate-50 px-6 py-10">
      <Logo to="/" suffix="Seller" />
      <div className="mt-10 w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 grid size-11 place-items-center rounded-lg bg-primary-soft text-primary">
          <Store className="size-5" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Create your seller account</h1>
        <p className="mt-1 text-sm text-slate-500">
          {formatPhone(state.phone)} is verified. Tell us who you are — you&apos;ll add business and bank details next.
        </p>

        <form onSubmit={form.handleSubmit((v) => createAccount.mutate(v))} className="mt-6 flex flex-col gap-4" noValidate>
          <Field label="Your name" required error={e.contactName?.message}>
            {(p) => <Input {...p} autoComplete="name" autoFocus {...form.register('contactName')} />}
          </Field>
          <Field label="Business email" required error={e.email?.message} hint="So our team can reach you about your account">
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
          </Field>
          <Field label="Store name" required error={e.storeName?.message} hint="Shown to buyers. You can change it later.">
            {(p) => <Input {...p} autoComplete="organization" {...form.register('storeName')} />}
          </Field>
          {error && !Object.keys(error.fields).length && (
            <Alert
              tone="danger"
              action={
                expired && (
                  <Button size="sm" variant="outline" onClick={() => navigate('/vendor/login', { replace: true })}>
                    Verify again
                  </Button>
                )
              }
            >
              {error.message}
            </Alert>
          )}
          <Button type="submit" size="lg" loading={createAccount.isPending}>
            Create account
          </Button>
        </form>
      </div>
    </div>
  )
}
