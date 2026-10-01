import { Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/core/lib/cn'
import { fromPaise, toPaise } from '@/core/lib/format'
import { controlClass } from './controlClass'
import { Input } from './Field'

/** 10-digit Indian mobile with a fixed +91 prefix. Value is the bare 10 digits. */
export function PhoneInput({ value, onChange, className, ...props }) {
  return (
    <div className={cn('flex', className)}>
      <span className="inline-flex h-11 items-center rounded-l-md border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-600">
        +91
      </span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        placeholder="98765 43210"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        className={cn(controlClass, 'h-11 rounded-l-none text-base tracking-wide')}
        {...props}
      />
    </div>
  )
}

/** Segmented one-time-code input with paste + SMS autofill support. */
export function OtpInput({ length = 6, value, onChange, onComplete, disabled, autoFocus = true, invalid }) {
  const refs = useRef([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const setAt = (i, char) => {
    const next = digits.slice()
    next[i] = char
    const joined = next.join('').slice(0, length)
    onChange(joined)
    if (joined.length === length) onComplete?.(joined)
  }

  const handleChange = (i, raw) => {
    const clean = raw.replace(/\D/g, '')
    if (clean.length > 1) {
      // Paste or SMS autofill into one box: spread across all.
      const code = clean.slice(0, length)
      onChange(code)
      refs.current[Math.min(code.length, length - 1)]?.focus()
      if (code.length === length) onComplete?.(code)
      return
    }
    setAt(i, clean)
    if (clean && i < length - 1) refs.current[i + 1]?.focus()
  }

  const handleKey = (i, e) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus()
  }

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="One-time code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          maxLength={length}
          disabled={disabled}
          value={d}
          onFocus={(e) => e.target.select()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          className={cn(controlClass, 'tabular h-12 w-full max-w-12 px-0 text-center text-lg font-semibold')}
        />
      ))}
    </div>
  )
}

/**
 * Money input: shows rupees, reports paise. Keeps a local string so typing "12." works.
 */
export function PriceInput({ value, onChange, placeholder = '0', ...props }) {
  const [text, setText] = useState(value == null || value === '' ? '' : String(fromPaise(value)))
  const lastPaise = useRef(value)

  useEffect(() => {
    if (value !== lastPaise.current) {
      lastPaise.current = value
      setText(value == null || value === '' ? '' : String(fromPaise(value)))
    }
  }, [value])

  return (
    <Input
      prefix="₹"
      inputMode="decimal"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
        if (!/^\d*(\.\d{0,2})?$/.test(next)) return
        setText(next)
        const paise = next === '' ? undefined : toPaise(next)
        lastPaise.current = paise
        onChange(paise)
      }}
      {...props}
    />
  )
}

export function NumberInput({ value, onChange, min = 0, ...props }) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={min}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      {...props}
    />
  )
}

export function QuantityStepper({ value, onChange, min = 1, max = 9999, disabled, size = 'md' }) {
  const h = size === 'sm' ? 'h-8' : 'h-10'
  return (
    <div className={cn('inline-flex items-center rounded-md border border-slate-300 bg-white', disabled && 'opacity-60')}>
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className={cn(h, 'grid w-9 place-items-center text-slate-600 hover:text-slate-900 disabled:opacity-40')}
      >
        <Minus className="size-4" />
      </button>
      <input
        aria-label="Quantity"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          if (n) onChange(Math.min(max, Math.max(min, n)))
        }}
        className={cn(h, 'tabular w-12 border-x border-slate-200 text-center text-sm font-semibold focus:outline-none')}
      />
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className={cn(h, 'grid w-9 place-items-center text-slate-600 hover:text-slate-900 disabled:opacity-40')}
      >
        <Plus className="size-4" />
      </button>
    </div>
  )
}

/** Hex colour with swatch picker + text field. */
export function ColorInput({ value, onChange, id, ...props }) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-slate-300 shadow-xs" style={{ background: value }}>
        <span className="sr-only">Pick colour</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          const v = e.target.value.trim()
          onChange(v.startsWith('#') ? v : `#${v}`)
        }}
        maxLength={7}
        className="tabular font-mono uppercase"
        {...props}
      />
    </div>
  )
}

/** Chips input for tags / compatible models. Enter or comma adds. */
export function TagInput({ value = [], onChange, placeholder = 'Type and press Enter', max = 20 }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim().replace(/,$/, '')
    if (v && !value.includes(v) && value.length < max) onChange([...value, v])
    setDraft('')
  }
  return (
    <div className={cn(controlClass, 'flex min-h-10 flex-wrap items-center gap-1.5 py-1.5')}>
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          {t}
          <button
            type="button"
            aria-label={`Remove ${t}`}
            onClick={() => onChange(value.filter((x) => x !== t))}
            className="text-slate-400 hover:text-slate-700"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none"
      />
    </div>
  )
}
