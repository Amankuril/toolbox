import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'
import { one, publicApi } from '@/core/api/http'
import { parseApiError } from '@/core/api/errors'
import { safeNext, useSessionBootstrap } from '@/core/auth/bootstrap'
import { sessions } from '@/core/auth/session'
import { email } from '@/core/lib/validators'
import { Logo } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { Field, Input } from '@/ui/Field'
import { FullPageLoader } from '@/ui/Spinner'

const schema = z.object({ email, password: z.string().min(1, 'Password is required') })

export default function AdminLoginPage() {
  const status = useSessionBootstrap('admin', { always: true })
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [show, setShow] = useState(false)
  const next = safeNext(params.get('next'), '/admin')

  const { register, handleSubmit, formState } = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })
  const login = useMutation({
    mutationFn: (body) => one(publicApi.post('/auth/admin/login', body)),
    onSuccess: (data) => {
      sessions.admin.getState().signIn(data)
      navigate(next, { replace: true })
    },
  })

  if (status === 'checking' || status === 'idle') return <FullPageLoader />
  if (status === 'authenticated') return <Navigate to={next} replace />

  const error = login.error && parseApiError(login.error)

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-secondary p-10 text-secondary-fg lg:flex">
        <Logo to="/admin/login" inverted suffix="Admin" />
        <div>
          <p className="text-3xl leading-tight font-bold">Run the whole marketplace from one place.</p>
          <p className="mt-3 max-w-md text-secondary-fg/70">
            Approve sellers, moderate the catalogue, track orders and control payments, storage and the look of every module.
          </p>
        </div>
        <p className="text-sm text-secondary-fg/50">Restricted area. All access is logged.</p>
      </div>

      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo to="/admin/login" suffix="Admin" />
          </div>
          <div className="mb-6 grid size-11 place-items-center rounded-lg bg-primary-soft text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Admin sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the email and password issued to you.</p>

          <form onSubmit={handleSubmit((v) => login.mutate(v))} className="mt-8 flex flex-col gap-4" noValidate>
            <Field label="Email" error={formState.errors.email?.message}>
              {(p) => <Input {...p} type="email" autoComplete="username" autoFocus {...register('email')} />}
            </Field>
            <Field label="Password" error={formState.errors.password?.message}>
              {(p) => (
                <div className="relative">
                  <Input {...p} type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-10" {...register('password')} />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 grid w-10 place-items-center text-slate-400 hover:text-slate-700"
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              )}
            </Field>
            {error && <Alert tone="danger">{error.message}</Alert>}
            <Button type="submit" size="lg" loading={login.isPending}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
