import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Layers, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Card'
import { storeApi, storeKeys } from '../api'
import { HeroCarousel } from '../components/HeroCarousel'
import { ProductRail, SectionHeading } from '../components/ProductCard'
import { useCategoryTree } from '../hooks'

function useProducts(params) {
  return useQuery({ queryKey: storeKeys.products(params), queryFn: () => storeApi.products(params), staleTime: 60_000 })
}

/** The trade buyer's shortcut: search by the machine you own, land on parts that fit it. */
function PartsFinder() {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef(null)
  const sectionRef = useRef(null)
  const [model, setModel] = useState('')

  useEffect(() => {
    if (location.hash === '#parts-finder') {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [location.hash])

  return (
    <section ref={sectionRef} id="parts-finder" className="flex flex-col justify-between rounded-md bg-secondary p-6 text-secondary-fg">
      <div>
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-secondary-fg/60 uppercase">Spare parts finder</p>
        <h2 className="mt-2 font-display text-[1.9rem] leading-[1.05] font-bold">Find parts that fit your machine</h2>
        <p className="mt-2 text-sm text-secondary-fg/70">Enter the model number on the machine’s rating plate.</p>
      </div>
      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (model.trim()) navigate(`/search?q=${encodeURIComponent(model.trim())}&type=part`)
        }}
      >
        <label htmlFor="parts-model" className="sr-only">
          Machine model number
        </label>
        <div className="flex overflow-hidden rounded-md bg-white">
          <input
            id="parts-model"
            ref={inputRef}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. GSB 550, KS-128"
            className="min-w-0 flex-1 px-3 py-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button type="submit" aria-label="Find parts" className="grid w-12 place-items-center bg-primary text-primary-fg hover:bg-primary-hover">
            <Search className="size-5" />
          </button>
        </div>
      </form>
    </section>
  )
}

function BulkCallout() {
  return (
    <Link to="/search?bulk=true" className="group flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-slate-200 px-5 py-3.5 hover:border-slate-400">
      <Layers className="size-5 shrink-0 text-accent-ink" strokeWidth={1.75} />
      <span className="font-display text-lg leading-tight font-bold text-slate-900">Buying in bulk?</span>
      <span className="min-w-0 flex-1 text-sm text-slate-600">Price breaks apply automatically in your cart. For larger orders, ask the seller for a quote.</span>
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-slate-900 group-hover:underline">
        Shop bulk deals <ArrowRight className="size-4" />
      </span>
    </Link>
  )
}

function FallbackHero({ siteName }) {
  return (
    <section className="flex flex-col justify-end rounded-md bg-gradient-to-br from-emerald-50/60 to-[#f4f7f2] p-8 sm:p-12 relative overflow-hidden">
      <div className="flex items-center gap-2.5 mb-2">
        <img src="/toolboxlogo.jpeg" alt={siteName} className="size-8 rounded-lg object-contain bg-white shadow-xs p-0.5" />
        <p className="font-display text-sm font-semibold tracking-[0.14em] text-primary uppercase">{siteName}</p>
      </div>
      <h1 className="mt-1 max-w-xl font-display text-4xl leading-[1.02] font-bold text-slate-900 sm:text-5xl">
        Tools, machinery and parts for a greener tomorrow.
      </h1>
      <div className="mt-6">
        <Button size="lg" asChild>
          <a href="#departments">Shop departments</a>
        </Button>
      </div>
    </section>
  )
}

/** Department directory: every root with its sub-departments as plain links, like a trade catalogue index. */
function Departments({ tree, loading }) {
  return (
    <section id="departments" className="mx-auto mt-14 max-w-7xl scroll-mt-40 px-4 sm:px-6">
      <SectionHeading title="Shop by department" />
      {loading ? (
        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : (
        <div className="grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {tree.map((dept) => (
            <div key={dept._id} className="flex gap-4 bg-white p-5">
              <Link to={`/c/${dept.slug}`} className="shrink-0" tabIndex={-1} aria-hidden>
                <Thumb src={dept.image?.url} alt="" className="size-20 rounded bg-[#f4f4f2]" fit="cover" />
              </Link>
              <div className="min-w-0">
                <Link to={`/c/${dept.slug}`} className="font-display text-xl leading-tight font-bold text-slate-900 hover:underline">
                  {dept.name}
                </Link>
                <ul className="mt-2 flex flex-col gap-1">
                  {(dept.children ?? []).slice(0, 4).map((sub) => (
                    <li key={sub._id}>
                      <Link to={`/c/${sub.slug}`} className="text-sm text-slate-600 hover:text-slate-900 hover:underline">
                        {sub.name}
                      </Link>
                    </li>
                  ))}
                </ul>
                {dept.children?.length > 4 && (
                  <Link to={`/c/${dept.slug}`} className="mt-1.5 inline-block text-sm font-semibold text-slate-900 hover:underline">
                    + {dept.children.length - 4} more
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Brands({ brands }) {
  if (!brands?.length) return null
  return (
    <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
      <SectionHeading title="Brands" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-4 lg:grid-cols-6">
        {brands.slice(0, 12).map((b) => (
          <Link
            key={b.value}
            to={`/search?brand=${encodeURIComponent(b.value)}`}
            className="flex h-20 items-center justify-center bg-white px-3 text-center font-display text-xl font-bold tracking-wide text-slate-400 uppercase transition-colors hover:text-slate-900"
          >
            {b.value}
          </Link>
        ))}
      </div>
    </section>
  )
}

const HOW_IT_WORKS = [
  { title: 'Reviewed sellers', text: 'Every store’s GST and bank details are checked before it can sell.' },
  { title: 'Parts matched to machines', text: 'Sellers link spare parts to the exact models they fit.' },
  { title: 'Bulk pricing built in', text: 'Price breaks apply in your cart. Need more? Request a quote.' },
  { title: 'GST billing', text: 'Add your GSTIN at checkout; it’s shared with the seller for billing.' },
]

export default function HomePage() {
  const { data: settings } = usePublicSettings()
  const { data: tree = [], isLoading: treeLoading } = useCategoryTree()
  const { data: banners = [], isLoading: bannersLoading } = useQuery({ queryKey: storeKeys.banners, queryFn: storeApi.banners, staleTime: 5 * 60_000 })
  const featured = useProducts({ featured: true, limit: 12 })
  const bulk = useProducts({ bulk: true, limit: 12 })
  const latest = useProducts({ sort: 'newest', limit: 12 })
  const brands = useProducts({ limit: 1 }).data?.meta?.facets?.brands

  const siteName = settings?.branding.siteName ?? 'ToolsHubs'
  const hero = banners.filter((b) => b.placement === 'home_hero')
  const offers = banners.filter((b) => b.placement === 'home_offer')
  const strip = banners.find((b) => b.placement === 'home_strip')

  return (
    <>
      <title>{`${siteName} — Tools for a Greener Tomorrow`}</title>

      <div className="mx-auto grid max-w-7xl gap-4 px-4 pt-5 sm:px-6 lg:h-[340px] lg:grid-cols-[1fr_340px]">
        {bannersLoading ? (
          <Skeleton className="aspect-[16/5] w-full rounded-md lg:aspect-auto lg:h-full" />
        ) : hero.length ? (
          <HeroCarousel banners={hero} fill />
        ) : (
          <FallbackHero siteName={siteName} />
        )}
        <PartsFinder />
      </div>
      <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-6">
        <BulkCallout />
      </div>

      <Departments tree={tree} loading={treeLoading} />

      {offers.length > 0 && (
        <section className="mx-auto mt-14 grid max-w-7xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          {offers.slice(0, 3).map((b) => (
            <Link key={b._id} to={b.link || '#'} className="block overflow-hidden rounded-md">
              <img src={b.image.url} alt={b.title} loading="lazy" className="aspect-[2/1] w-full object-cover transition-transform duration-500 hover:scale-[1.02]" />
            </Link>
          ))}
        </section>
      )}

      <ProductRail className="mt-16" title="Featured" products={featured.data?.items} loading={featured.isLoading} viewAll="/search?featured=true" />
      <ProductRail
        className="mt-16"
        title="Bulk deals"
        subtitle="The more you buy, the lower the price per unit"
        products={bulk.data?.items}
        loading={bulk.isLoading}
        viewAll="/search?bulk=true"
      />

      {strip && (
        <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
          <Link to={strip.link || '#'} className="block overflow-hidden rounded-md">
            <img src={strip.image.url} alt={strip.title} loading="lazy" className="aspect-[16/3] w-full object-cover" />
          </Link>
        </section>
      )}

      <ProductRail className="mt-16" title="New in" products={latest.data?.items} loading={latest.isLoading} viewAll="/search?sort=newest" />
      {tree.slice(0, 3).map((c) => (
        <DepartmentRail key={c._id} department={c} />
      ))}

      <Brands brands={brands} />

      <section className="mt-20 border-y border-slate-200 bg-[#f6f6f4]">
        <div className="mx-auto grid max-w-7xl gap-px px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {HOW_IT_WORKS.map((item, i) => (
            <div key={item.title} className={`py-8 lg:px-6 ${i > 0 ? 'lg:border-l lg:border-slate-200' : 'lg:pl-0'}`}>
              <p className="font-display text-sm font-semibold text-slate-400 tabular">0{i + 1}</p>
              <h3 className="mt-1 font-display text-xl font-bold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-7xl px-4 sm:px-6">
        <div className="grid items-center gap-6 rounded-md border-2 border-slate-900 p-8 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className="font-display text-3xl leading-tight font-bold text-slate-900">Sell on {siteName}</h2>
            <p className="mt-2 max-w-2xl text-slate-600">
              Dealers, distributors and manufacturers: list tools, machinery and spare parts, set bulk prices, answer quote requests and manage orders from one dashboard.
            </p>
          </div>
          <Button size="lg" variant="secondary" asChild>
            <Link to="/vendor/login">
              Start selling <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  )
}

function DepartmentRail({ department }) {
  const { data, isLoading } = useProducts({ category: department.slug, limit: 12 })
  return <ProductRail className="mt-16" title={department.name} products={data?.items} loading={isLoading} viewAll={`/c/${department.slug}`} />
}
