import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { one, publicApi } from '@/core/api/http'
import { applyTheme, cacheThemes } from '@/core/theme/theme'

export const publicSettingsKey = ['public', 'settings']

export function usePublicSettings() {
  return useQuery({
    queryKey: publicSettingsKey,
    queryFn: () => one(publicApi.get('/public/settings')),
    staleTime: 5 * 60_000,
  })
}

/** Applies (and caches) the admin-defined theme for the module the user is in. */
export function useModuleTheme(module) {
  const { data } = usePublicSettings()
  useEffect(() => {
    if (!data?.theme) return
    cacheThemes(data.theme)
    applyTheme(module, data.theme[module])
  }, [module, data?.theme])
  return data
}

export function useBranding() {
  const { data } = usePublicSettings()
  return data?.branding ?? { siteName: 'ToolsHubs', tagline: 'Tools for a greener tomorrow', modules: {} }
}
