import { useSearchParams } from 'react-router'
import { useBranding } from '@/core/settings/usePublicSettings'
import { ProductListing } from '../components/ProductListing'

export default function SearchPage() {
  const [params] = useSearchParams()
  const { siteName } = useBranding()
  const q = params.get('q')?.trim() ?? ''
  const title = q ? `Results for “${q}”` : params.get('featured') ? 'Featured products' : params.get('sort') === 'newest' ? 'New arrivals' : 'All products'

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <title>{`${q ? `${q} — Search` : title} | ${siteName}`}</title>
      <meta name="robots" content="noindex" />
      <ProductListing key={q} base={{ q: q || undefined }} heading={<h1 className="text-2xl font-bold text-slate-900">{title}</h1>} />
    </div>
  )
}
