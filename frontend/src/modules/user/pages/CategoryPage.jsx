import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { useBranding } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { EmptyState, Skeleton } from '@/ui/Card'
import { Button } from '@/ui/Button'
import { storeApi, storeKeys } from '../api'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { ProductListing } from '../components/ProductListing'

export default function CategoryPage() {
  const { slug } = useParams()
  const { siteName } = useBranding()
  const { data: category, isLoading, isError } = useQuery({ queryKey: storeKeys.category(slug), queryFn: () => storeApi.category(slug), retry: false })

  if (isError) {
    return (
      <EmptyState
        className="mx-auto max-w-7xl"
        title="Category not found"
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

      {isLoading ? (
        <Skeleton className="h-5 w-64" />
      ) : (
        <Breadcrumbs items={[...category.breadcrumbs.map((b) => ({ label: b.name, to: `/c/${b.slug}` })), { label: category.name }]} />
      )}

      {category?.children?.length > 0 && (
        <div className="scrollbar-none -mx-4 mt-5 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {category.children.map((c) => (
            <Link
              key={c._id}
              to={`/c/${c.slug}`}
              className="flex shrink-0 items-center gap-2.5 rounded-full border border-slate-200 bg-white py-1.5 pr-4 pl-1.5 text-sm font-medium text-slate-700 hover:border-primary hover:text-primary"
            >
              <Thumb src={c.image?.url} className="size-8 rounded-full" fit="cover" />
              {c.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6">
        <ProductListing
          key={slug}
          base={{ category: slug }}
          heading={
            <>
              <h1 className="text-2xl font-bold text-slate-900">{category?.name ?? ' '}</h1>
              {category?.description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{category.description}</p>}
            </>
          }
        />
      </div>
    </div>
  )
}
