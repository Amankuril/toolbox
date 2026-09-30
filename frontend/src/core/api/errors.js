/**
 * Normalises any thrown value into { message, code, status, fields }.
 * `fields` maps "a.b" → message, straight from the API's 422 details.
 */
export function parseApiError(error) {
  const status = error?.response?.status
  const body = error?.response?.data?.error

  if (!error?.response) {
    return {
      status: 0,
      code: error?.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK',
      message: error?.code === 'ECONNABORTED' ? 'The request timed out. Please try again.' : 'Could not reach the server. Check your connection.',
      fields: {},
    }
  }

  const fields = {}
  if (Array.isArray(body?.details)) {
    for (const d of body.details) if (d?.path && !fields[d.path]) fields[d.path] = d.message
  }

  return {
    status,
    code: body?.code ?? 'UNKNOWN',
    message: body?.message ?? 'Something went wrong. Please try again.',
    fields,
    details: body?.details,
    retryAfter: Number(error.response.headers?.['retry-after']) || undefined,
  }
}

export const errorMessage = (error) => parseApiError(error).message

/** Pushes API field errors into react-hook-form. Returns true if any field matched. */
export function applyFieldErrors(error, setError, { map = {} } = {}) {
  const { fields } = parseApiError(error)
  let matched = false
  for (const [path, message] of Object.entries(fields)) {
    setError(map[path] ?? path, { type: 'server', message })
    matched = true
  }
  return matched
}
