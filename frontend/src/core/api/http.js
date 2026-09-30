import axios from 'axios'
import { API_URL, AUDIENCES } from '@/core/config'
import { sessions, setRefreshHandler } from '@/core/auth/session'

/** Anonymous endpoints (/public, /auth). Cookies are sent so /auth refresh works. */
export const publicApi = axios.create({ baseURL: API_URL, withCredentials: true, timeout: 20_000 })

const inflight = {}

async function performRefresh(audience) {
  const run = async () => {
    try {
      const res = await publicApi.post(`/auth/${audience}/refresh`)
      sessions[audience].getState().signIn(res.data.data)
      return true
    } catch (err) {
      // Another tab rotated the cookie a moment ago: the new cookie is already in the jar, so retry once.
      if (err.response?.data?.error?.code === 'SESSION_ROTATED') {
        try {
          const res = await publicApi.post(`/auth/${audience}/refresh`)
          sessions[audience].getState().signIn(res.data.data)
          return true
        } catch {
          /* fall through to sign out */
        }
      }
      sessions[audience].getState().signOut()
      return false
    }
  }
  // Web Locks serialise refreshes across tabs so two tabs never rotate the same token together.
  return navigator.locks?.request ? navigator.locks.request(`tb-refresh-${audience}`, run) : run()
}

/** Single-flight refresh per audience. Resolves true when a new access token was obtained. */
export function refreshSession(audience) {
  inflight[audience] ??= performRefresh(audience).finally(() => {
    inflight[audience] = null
  })
  return inflight[audience]
}

setRefreshHandler(refreshSession)

const RETRYABLE_AUTH_CODES = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID', 'NO_TOKEN'])

function createAudienceClient(audience) {
  const client = axios.create({ baseURL: `${API_URL}/${audience}`, withCredentials: true, timeout: 30_000 })

  client.interceptors.request.use((config) => {
    const token = sessions[audience].getState().accessToken
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      const { config, response } = error
      const code = response?.data?.error?.code
      if (response?.status === 401 && config && !config._retried && RETRYABLE_AUTH_CODES.has(code)) {
        config._retried = true
        if (await refreshSession(audience)) {
          config.headers.Authorization = `Bearer ${sessions[audience].getState().accessToken}`
          return client(config)
        }
      } else if (response?.status === 401 || (response?.status === 403 && ['ACCOUNT_BLOCKED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_DISABLED'].includes(code))) {
        sessions[audience].getState().signOut()
      }
      return Promise.reject(error)
    },
  )

  return client
}

export const api = Object.fromEntries(AUDIENCES.map((a) => [a, createAudienceClient(a)]))

/** Unwrap `{ success, data }` → data */
export const one = (promise) => promise.then((r) => r.data.data)
/** Unwrap `{ success, data, meta }` → { items, meta } */
export const list = (promise) => promise.then((r) => ({ items: r.data.data, meta: r.data.meta }))

export async function signOutEverywhere(audience) {
  try {
    await publicApi.post(`/auth/${audience}/logout`)
  } finally {
    sessions[audience].getState().signOut()
  }
}
