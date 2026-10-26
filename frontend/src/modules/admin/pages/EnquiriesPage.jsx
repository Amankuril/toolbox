import { useBranding } from '@/core/settings/usePublicSettings'
import { EnquiriesPage } from '@/modules/shared/Enquiries'
import { adminApi, adminKeys } from '../api'

const client = { root: adminKeys.all, list: adminApi.enquiries, setStatus: adminApi.setEnquiryStatus }

export default function AdminEnquiriesPage() {
  const { siteName } = useBranding()
  return <EnquiriesPage client={client} showVendor from={siteName} />
}
