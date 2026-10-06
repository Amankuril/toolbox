import { Navigate } from 'react-router'
import { ProductImport } from '@/modules/shared/ProductImport'
import { PageHeader } from '@/ui/PageHeader'
import { useVendor, vendorApi } from '../api'

export default function ProductImportPage() {
  const vendor = useVendor()
  if (vendor && vendor.status !== 'approved') return <Navigate to="/vendor/products" replace />
  return (
    <>
      <PageHeader
        back={{ to: '/vendor/products', label: 'Products' }}
        title="Bulk upload products"
        description="Add or update many products at once from an Excel or CSV file."
      />
      <ProductImport panel="vendor" api={vendorApi.productImports} productsPath="/vendor/products" />
    </>
  )
}
