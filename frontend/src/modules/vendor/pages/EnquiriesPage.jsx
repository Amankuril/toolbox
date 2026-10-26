import { EnquiriesPage } from '@/modules/shared/Enquiries'
import { useSeller } from '../seller'

export default function SellerEnquiriesPage() {
  const seller = useSeller()
  const account = seller.useAccount()
  return <EnquiriesPage client={{ root: seller.keys.all, list: seller.api.enquiries, setStatus: seller.api.setEnquiryStatus }} from={account?.store?.name} />
}
