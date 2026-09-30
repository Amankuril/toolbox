import { useMutation } from '@tanstack/react-query'
import { ArrowRight, PencilLine, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { one, publicApi } from '@/core/api/http'
import { parseApiError } from '@/core/api/errors'
import { sessions } from '@/core/auth/session'
import { formatPhone } from '@/core/lib/format'
import { phone10 } from '@/core/lib/validators'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { OtpInput, PhoneInput } from '@/ui/inputs'

function useCountdown() {
  const [until, setUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= now) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [until, now])
  return [Math.max(0, Math.ceil((until - now) / 1000)), (seconds) => {
    setNow(Date.now())
    setUntil(Date.now() + seconds * 1000)
  }]
}

/**
 * Mobile OTP sign-in used by customers and vendors.
 * Existing number → signed in (onAuthenticated). New number → onOnboarding({ onboardingToken, phone }).
 *
 * @param {{ audience: 'user'|'vendor', onAuthenticated: (account) => void, onOnboarding: (v: { onboardingToken: string, phone: string }) => void }} props
 */
export function OtpSignIn({ audience, onAuthenticated, onOnboarding }) {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState(null)
  const [resendIn, startCountdown] = useCountdown()

  const send = useMutation({
    mutationFn: () => one(publicApi.post('/auth/otp/send', { phone, audience })),
    onSuccess: (data) => {
      setError(null)
      setOtp('')
      setStep('otp')
      startCountdown(data.resendIn)
    },
    onError: (err) => {
      const e = parseApiError(err)
      setError(e.message)
      // Cooldown from a previous send: go to the code step anyway so they can type the code they got.
      if (e.code === 'OTP_COOLDOWN') {
        setStep('otp')
        startCountdown(e.retryAfter ?? 30)
      }
    },
  })

  const verify = useMutation({
    mutationFn: (code) => one(publicApi.post('/auth/otp/verify', { phone, audience, otp: code })),
    onSuccess: (data) => {
      if (data.status === 'authenticated') {
        sessions[audience].getState().signIn(data)
        onAuthenticated(data.account)
      } else {
        onOnboarding({ onboardingToken: data.onboardingToken, phone: data.phone })
      }
    },
    onError: (err) => {
      setError(parseApiError(err).message)
      setOtp('')
    },
  })

  const submitPhone = (e) => {
    e.preventDefault()
    const parsed = phone10.safeParse(phone)
    if (!parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }
    setPhone(parsed.data)
    send.mutate()
  }

  if (step === 'phone') {
    return (
      <form onSubmit={submitPhone} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="otp-phone" className="text-sm font-medium text-slate-800">
            Mobile number
          </label>
          <PhoneInput id="otp-phone" value={phone} onChange={(v) => (setPhone(v), setError(null))} autoFocus aria-invalid={Boolean(error) || undefined} />
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" size="lg" loading={send.isPending} disabled={phone.length !== 10}>
          Get OTP <ArrowRight />
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <ShieldCheck className="size-3.5" /> We&apos;ll text a 6-digit code. Standard SMS rates may apply.
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
        Enter the code sent to <span className="font-semibold text-slate-900">{formatPhone(`+91${phone}`)}</span>
        <button
          type="button"
          onClick={() => (setStep('phone'), setError(null))}
          className="ml-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <PencilLine className="size-3.5" /> Change
        </button>
      </div>
      <OtpInput value={otp} onChange={(v) => (setOtp(v), setError(null))} onComplete={(code) => verify.mutate(code)} disabled={verify.isPending} invalid={Boolean(error)} />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" size="lg" loading={verify.isPending} disabled={otp.length !== 6}>
        Verify &amp; continue
      </Button>
      <p className="text-center text-sm text-slate-500">
        Didn&apos;t get it?{' '}
        {resendIn > 0 ? (
          <span className="tabular">Resend in {resendIn}s</span>
        ) : (
          <button type="button" className="font-medium text-primary hover:underline disabled:opacity-50" disabled={send.isPending} onClick={() => send.mutate()}>
            Resend code
          </button>
        )}
      </p>
    </form>
  )
}
