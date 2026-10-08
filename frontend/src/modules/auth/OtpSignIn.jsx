import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Mail, PencilLine, ShieldCheck, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { one, publicApi } from '@/core/api/http'
import { parseApiError } from '@/core/api/errors'
import { sessions } from '@/core/auth/session'
import { formatPhone } from '@/core/lib/format'
import { email as emailSchema, phone10 } from '@/core/lib/validators'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { SegmentedControl } from '@/ui/Controls'
import { Input } from '@/ui/Field'
import { OtpInput, PhoneInput } from '@/ui/inputs'
import { track } from '@/core/analytics/ga'

function useCountdown() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= now) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [until, now])
  return [
    Math.max(0, Math.ceil((until - now) / 1000)),
    (seconds) => {
      setNow(Date.now())
      setUntil(Date.now() + seconds * 1000)
    },
  ]
}

const CHANNELS = [
  {
    value: 'phone',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Smartphone className="size-4" /> Mobile
      </span>
    ),
  },
  {
    value: 'email',
    label: (
      <span className="inline-flex items-center gap-1.5">
        <Mail className="size-4" /> Email
      </span>
    ),
  },
]

/**
 * One-time-code sign-in for customers and vendors, by mobile number or email.
 * Existing account → signed in (onAuthenticated). New → onOnboarding({ onboardingToken, phone?, email? }).
 *
 * @param {{ audience: 'user'|'vendor', onAuthenticated: (account) => void,
 *   onOnboarding: (v: { onboardingToken: string, phone?: string, email?: string }) => void }} props
 */
export function OtpSignIn({ audience, onAuthenticated, onOnboarding }) {
  const [channel, setChannel] = useState('phone')
  const [step, setStep] = useState('target')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState(null)
  const [errorCode, setErrorCode] = useState(null)
  const [resendIn, startCountdown] = useCountdown()
  const target = channel === 'phone' ? { phone } : { email }
  const fail = (err) => {
    const e = parseApiError(err)
    setError(e.message)
    setErrorCode(e.code)
    return e
  }
  const clearError = () => (setError(null), setErrorCode(null))

  const send = useMutation({
    mutationFn: () => one(publicApi.post('/auth/otp/send', { ...target, audience })),
    onSuccess: (data) => {
      clearError()
      setOtp('')
      setStep('otp')
      startCountdown(data.resendIn)
    },
    onError: (err) => {
      const e = fail(err)
      // Cooldown from a previous send: go to the code step anyway so they can type the code they got.
      if (e.code === 'OTP_COOLDOWN') {
        setStep('otp')
        startCountdown(e.retryAfter ?? 30)
      }
    },
  })

  const verify = useMutation({
    mutationFn: (code) => one(publicApi.post('/auth/otp/verify', { ...target, audience, otp: code })),
    onSuccess: (data) => {
      if (data.status === 'authenticated') {
        // Only the storefront reports to Google Analytics.
        if (audience === 'user') track('login', { method: target.email ? 'email' : 'phone' })
        sessions[audience].getState().signIn(data)
        onAuthenticated(data.account)
      } else {
        onOnboarding({ onboardingToken: data.onboardingToken, ...(data.phone ? { phone: data.phone } : { email: data.email }) })
      }
    },
    onError: (err) => {
      fail(err)
      setOtp('')
    },
  })

  const submitTarget = (e) => {
    e.preventDefault()
    const parsed = (channel === 'phone' ? phone10 : emailSchema).safeParse(channel === 'phone' ? phone : email)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    if (channel === 'phone') setPhone(parsed.data)
    else setEmail(parsed.data)
    send.mutate()
  }

  const switchTo = (next) => {
    setChannel(next)
    setStep('target')
    setOtp('')
    clearError()
  }

  if (step === 'target') {
    const ready = channel === 'phone' ? phone.length === 10 : email.includes('@')
    return (
      <form onSubmit={submitTarget} className="flex flex-col gap-4" noValidate>
        <SegmentedControl value={channel} onChange={switchTo} options={CHANNELS} className="self-start" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="otp-target" className="text-sm font-medium text-slate-800">
            {channel === 'phone' ? 'Mobile number' : 'Email address'}
          </label>
          {channel === 'phone' ? (
            <PhoneInput id="otp-target" value={phone} onChange={(v) => (setPhone(v), clearError())} autoFocus aria-invalid={Boolean(error) || undefined} />
          ) : (
            <Input
              id="otp-target"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => (setEmail(e.target.value), clearError())}
              aria-invalid={Boolean(error) || undefined}
            />
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" loading={send.isPending} disabled={!ready}>
          Get code <ArrowRight />
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="size-3.5" />{' '}
          {channel === 'phone'
            ? 'We’ll text a 6-digit code. Standard SMS rates may apply.'
            : 'We’ll email you a 6-digit code. Check your spam folder if it doesn’t arrive.'}
        </p>
      </form>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (otp.length === 6) verify.mutate(otp)
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="text-sm text-slate-600">
        Enter the code sent to <span className="font-semibold text-slate-900">{channel === 'phone' ? formatPhone(`+91${phone}`) : email}</span>
        <button
          type="button"
          onClick={() => (setStep('target'), clearError())}
          className="ml-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <PencilLine className="size-3.5" /> Change
        </button>
      </div>
      <OtpInput
        value={otp}
        onChange={(v) => (setOtp(v), clearError())}
        onComplete={(code) => verify.mutate(code)}
        disabled={verify.isPending}
        invalid={Boolean(error)}
      />
      {error && (
        <Alert
          tone="danger"
          action={
            errorCode === 'SELLER_EMAIL_NOT_FOUND' && (
              <Button size="sm" variant="outline" onClick={() => switchTo('phone')}>
                Use mobile number
              </Button>
            )
          }
        >
          {error}
        </Alert>
      )}
      <Button type="submit" size="lg" loading={verify.isPending} disabled={otp.length !== 6}>
        Verify &amp; continue
      </Button>
      <p className="text-center text-sm text-slate-500">
        Didn&apos;t get it?{' '}
        {resendIn > 0 ? (
          <span className="tabular">Resend in {resendIn}s</span>
        ) : (
          <button
            type="button"
            className="font-medium text-primary hover:underline disabled:opacity-50"
            disabled={send.isPending}
            onClick={() => send.mutate()}
          >
            Resend code
          </button>
        )}
      </p>
    </form>
  )
}
