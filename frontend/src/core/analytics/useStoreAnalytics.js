import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { initAnalytics, trackPageView } from './ga'

/** Starts GA once settings load, and sends a page view per storefront navigation. */
export function useStoreAnalytics() {
  const { data: settings, isSuccess } = usePublicSettings()
  const location = useLocation()

  useEffect(() => {
    if (isSuccess) initAnalytics(settings?.analytics?.gaMeasurementId)
  }, [isSuccess, settings?.analytics?.gaMeasurementId])

  useEffect(() => {
    // Pages set their <title> as they render (product names arrive with the data); give them a moment.
    const timer = setTimeout(trackPageView, 400)
    return () => clearTimeout(timer)
  }, [location.pathname, location.search])
}
