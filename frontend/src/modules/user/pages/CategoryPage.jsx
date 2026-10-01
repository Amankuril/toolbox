import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Button } from '@/ui/Button'
import { EmptyState, Skeleton } from '@/ui/Card'
import { storeApi, storeKeys } from '../api'
import { ListingHeader } from '../components/ListingHeader'
import { ProductListing } from '../components/ProductListing'

export default function CategoryPage() {
  const { slug } = useParams()
  const { siteName } = useBranding()
  const { data: category, isLoading, isError } = useQuery({ queryKey: storeKeys.category(slug), queryFn: () => storeApi.category(slug), retry: false })

  if (isError) {
    return (
      <EmptyState
        className="mx-auto max-w-7xl"
        title="Department not found"
        description="It may have been renamed or removed."
        action={
          <Button asChild>
            <Link to="/">Back to home</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {category && <title>{`${category.seo?.title || category.name} | ${siteName}`}</title>}
      {category?.seo?.description && <meta name="description" content={category.seo.description} />}
      <ProductListing
        key={slug}
        base={{ category: slug }}
        heading={
          isLoading ? (
            <div className="border-b border-slate-200 pb-6">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="mt-5 h-10 w-80" />
            </div>
          ) : (
            <ListingHeader
              crumbs={[...category.breadcrumbs.map((b) => ({ label: b.name, to: `/c/${b.slug}` })), { label: category.name }]}
              title={category.name}
              description={category.description}
              subLinks={category.children?.map((c) => ({ to: `/c/${c.slug}`, label: c.name }))}
            />
          )
        }
      />
    </div>
  )
}
