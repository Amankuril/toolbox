import { SeoAuditPage } from '@/modules/shared/SeoAudit'
import { useSeller } from '../seller'

export default function SellerSeoAuditPage() {
  const seller = useSeller()
  return (
    <SeoAuditPage
      client={{ root: seller.keys.all, audit: seller.api.seoAudit, updateProduct: seller.api.updateProduct, editPath: (id) => `${seller.base}/products/${id}` }}
    />
  )
}
