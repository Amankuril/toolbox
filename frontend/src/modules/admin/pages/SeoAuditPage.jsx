import { SeoAuditPage } from '@/modules/shared/SeoAudit'
import { adminApi, adminKeys } from '../api'

const client = {
  root: adminKeys.all,
  audit: adminApi.seoAudit,
  site: adminApi.seoSiteAudit,
  updateProduct: adminApi.updateProduct,
  editPath: (id) => `/admin/products/${id}/edit`,
}

export default function AdminSeoAuditPage() {
  return <SeoAuditPage client={client} showSeller />
}
