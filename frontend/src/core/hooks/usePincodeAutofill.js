import { useEffect, useRef, useState } from 'react'
import { useWatch } from 'react-hook-form'
import { publicApi } from '@/core/api/http'
import { INDIAN_STATES } from '@/core/lib/constants'

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]/g, '')

/** India Post spellings vary slightly ("Jammu & Kashmir"); map them onto our state list. */
const matchState = (name) => INDIAN_STATES.find((s) => norm(s) === norm(name)) ?? null

/**
 * Fills `city` and `state` from a 6-digit `pincode` (India Post, via our API).
 * Only fills fields that are empty or still hold the previous auto-filled value,
 * so anything the user typed themselves is never overwritten. Lookup failures are silent.
 * @returns {{ status: null | 'loading' | 'found' | 'not_found', place: null | { city: string, state: string } }}
 */
export function usePincodeAutofill(form) {
  const pincode = useWatch({ control: form.control, name: 'pincode' })
  const filled = useRef({})
  // Answer for the last pincode looked up; status for the current one is derived below.
  const [answer, setAnswer] = useState({ pin: null, status: null, place: null })
  const pin = String(pincode ?? '').trim()
  const valid = /^[1-9]\d{5}$/.test(pin)

  useEffect(() => {
    if (!valid) return
    const controller = new AbortController()
    publicApi
      .get(`/public/pincodes/${pin}`, { signal: controller.signal })
      .then((res) => {
        const { city, state } = res.data.data
        const stateName = matchState(state)
        const fill = (field, value) => {
          if (!value) return
          const current = form.getValues(field)
          if (!current || current === filled.current[field]) {
            form.setValue(field, value, { shouldDirty: true, shouldValidate: true })
            filled.current[field] = value
          }
        }
        fill('city', city)
        fill('state', stateName)
        setAnswer({ pin, status: 'found', place: { city, state: stateName ?? state } })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setAnswer({ pin, status: err.response?.status === 404 ? 'not_found' : null, place: null })
      })
    return () => controller.abort()
  }, [pin, valid, form])

  if (!valid) return { status: null, place: null }
  if (answer.pin !== pin) return { status: 'loading', place: null }
  return { status: answer.status, place: answer.place }
}

/** Hint text for the pincode field. */
export function pincodeHint({ status, place }) {
  if (status === 'loading') return 'Looking up pincode…'
  if (status === 'found') return `${place.city}, ${place.state}`
  if (status === 'not_found') return 'We couldn’t find this pincode. Please check it.'
  return undefined
}
