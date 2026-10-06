import { Navigate } from 'react-router'
import { ProductImport } from '@/modules/shared/ProductImport'
import { PageHeader } from '@/ui/PageHeader'
import { useSeller } from '../seller'

export default function ProductImportPage() {
  const seller = useSeller()
  const vendor = seller.useAccount()
  if (vendor && vendor.status !== 'approved') return <Navigate to={`${seller.base}/products`} replace />
  return (
    <>
      <PageHeader
        back={{ to: `${seller.base}/products`, label: 'Products' }}
        title="Bulk upload products"
        description="Add or update many products at once from an Excel or CSV file."
      />
      <ProductImport panel="vendor" api={seller.api.productImports} productsPath={`${seller.base}/products`} />
    </>
  )
}
