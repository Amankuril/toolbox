import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { track } from '@/core/analytics/ga'
import { useBranding } from '@/core/settings/usePublicSettings'
import { ListingHeader } from '../components/ListingHeader'
import { ProductListing } from '../components/ProductListing'
import { useCategoryTree } from '../hooks'

export default function SearchPage() {
  const [params] = useSearchParams()
  const { siteName } = useBranding()
  const { data: tree = [] } = useCategoryTree()
  const q = params.get('q')?.trim() ?? ''
  const category = params.get('category') || undefined
  const department = tree.find((c) => c.slug === category)
  useEffect(() => {
    if (q) track('search', { search_term: q })
  }, [q])

  const title = q
    ? `“${q}”`
    : params.get('bulk')
      ? 'Bulk deals'
      : params.get('featured')
        ? 'Featured products'
        : params.get('sort') === 'newest'
          ? 'New in'
          : params.get('brand')
            ? params.get('brand').split(',').join(', ')
            : 'All products'
  const description = q
    ? department
      ? `Searching in ${department.name}`
      : null
    : params.get('bulk')
      ? 'Products with price breaks for larger quantities. The right price is applied automatically in your cart.'
      : null

  return (
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4">
      <title>{`${q ? `${q} — Search` : title} | ${siteName}`}</title>
      <meta name="robots" content="noindex" />
      <ProductListing
        key={`${q}|${category}`}
        base={{ q: q || undefined, category }}
        heading={<ListingHeader compact crumbs={[{ label: q ? 'Search' : title }]} eyebrow={q ? 'Search results for' : undefined} title={title} description={description} />}
      />
    </div>
  )
}
