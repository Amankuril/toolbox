import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

/**
 * URL search params as state: filters and pagination survive reload, back/forward and sharing.
 * Setting a filter resets `page` unless `page` itself is being set.
 */
export function useSearchParamsState(defaults = {}) {
  const [params, setParams] = useSearchParams()

  const values = useMemo(() => {
    const out = { ...defaults }
    for (const [k, v] of params.entries()) out[k] = v
    return out
    // defaults is expected to be a stable literal per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const update = useCallback(
    (patch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === null || v === '' || v === false) next.delete(k)
            else next.set(k, String(v))
          }
          if (!('page' in patch)) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  return [values, update]
}
