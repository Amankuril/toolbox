import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, User } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { applyFieldErrors, parseApiError } from '@/core/api/errors'
import { safeNext } from '@/core/auth/bootstrap'
import { sessions } from '@/core/auth/session'
import { cn } from '@/core/lib/cn'
import { formatPhone } from '@/core/lib/format'
import { optionalEmail, optionalGstin, required } from '@/core/lib/validators'
import { Button } from '@/ui/Button'
import { Alert, Card } from '@/ui/Card'
import { Field, Input } from '@/ui/Field'
import { userApi } from '../api'
import { mergeGuestCart } from '../cart/useCart'

const schema = z
  .object({
    name: required('Your name', 120),
    email: optionalEmail,
    accountType: z.enum(['individual', 'business']),
    businessName: z.string().trim().max(200).optional(),
    gstin: optionalGstin,
  })
  .refine((v) => v.accountType !== 'business' || v.businessName, { path: ['businessName'], message: 'Business name is required' })

const TYPES = [
  { value: 'individual', label: 'For myself', hint: 'Personal or home use', icon: User },
  { value: 'business', label: 'For my business', hint: 'Workshop, farm, factory or shop', icon: Building2 },
]

/** Shown after OTP when the number has no account yet. */
export default function UserOnboardingPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const next = safeNext(state?.next, '/')
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', accountType: 'individual', businessName: '', gstin: '' } })
  const accountType = useWatch({ control: form.control, name: 'accountType' })

  const createAccount = useMutation({
    mutationFn: (v) =>
      userApi.register({
        onboardingToken: state.onboardingToken,
        name: v.name,
        email: v.email || undefined,
        accountType: v.accountType,
        ...(v.accountType === 'business' ? { businessName: v.businessName, gstin: v.gstin || undefined } : {}),
      }),
    onSuccess: async (data) => {
      sessions.user.getState().signIn(data)
      await mergeGuestCart(qc)
      navigate(next, { replace: true })
    },
    onError: (err) => applyFieldErrors(err, form.setError),
  })

  if (!state?.onboardingToken) return <Navigate to="/login" replace />
  const error = createAccount.error && parseApiError(createAccount.error)
  const e = form.formState.errors

  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <title>Create your account</title>
      <Card className="p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">Welcome! Let&apos;s set up your account</h1>
        <p className="mt-1 text-sm text-slate-500">{formatPhone(state.phone)} is verified.</p>

        <form onSubmit={form.handleSubmit((v) => createAccount.mutate(v))} className="mt-6 flex flex-col gap-5" noValidate>
          <Field label="Full name" required error={e.name?.message}>
            {(p) => <Input {...p} autoComplete="name" autoFocus {...form.register('name')} />}
          </Field>
          <Field label="Email" error={e.email?.message} hint="Optional">
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">I&apos;m buying</p>
            <Controller
              name="accountType"
              control={form.control}
              render={({ field }) => (
                <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
                  {TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={field.value === t.value}
                      onClick={() => field.onChange(t.value)}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 text-left',
                        field.value === t.value ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-slate-200 hover:border-slate-300',
                      )}
                    >
                      <t.icon className={cn('mt-0.5 size-5', field.value === t.value ? 'text-primary' : 'text-slate-400')} />
                      <span>
                        <span className="block text-sm font-semibold text-slate-900">{t.label}</span>
                        <span className="block text-xs text-slate-500">{t.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            />
          </div>

          {accountType === 'business' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name" required error={e.businessName?.message}>
                {(p) => <Input {...p} autoComplete="organization" {...form.register('businessName')} />}
              </Field>
              <Field label="GSTIN" error={e.gstin?.message} hint="Optional — prefilled at checkout">
                {(p) => <Input {...p} className="font-mono uppercase" maxLength={15} {...form.register('gstin')} />}
              </Field>
            </div>
          )}

          {error && !Object.keys(error.fields).length && (
            <Alert
              tone="danger"
              action={
                error.code === 'ONBOARDING_TOKEN_INVALID' && (
                  <Button size="sm" variant="outline" onClick={() => navigate('/login', { replace: true })}>
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
      </Card>
    </div>
  )
}
