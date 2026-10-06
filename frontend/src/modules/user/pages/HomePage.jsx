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
import { ServiceStrip, StatsBand } from '../components/Highlights'
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
    <section
      ref={sectionRef}
      id="parts-finder"
      className="flex flex-col justify-between gap-4 rounded-md border-[1.5px] border-slate-900 bg-white p-5 sm:flex-row sm:items-center"
    >
      <div className="min-w-0">
        <p className="eyebrow">Spare parts finder</p>
        <h2 className="mt-1 text-xl leading-tight font-extrabold text-slate-900">Find parts that fit your machine</h2>
        <p className="mt-1 text-sm text-slate-600">Enter the model number on the machine’s rating plate.</p>
      </div>
      <form
        className="w-full sm:max-w-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (model.trim()) navigate(`/search?q=${encodeURIComponent(model.trim())}&type=part`)
        }}
      >
        <label htmlFor="parts-model" className="sr-only">
          Machine model number
        </label>
        <div className="flex h-11 overflow-hidden rounded-md border border-slate-300 bg-white focus-within:border-primary">
          <input
            id="parts-model"
            ref={inputRef}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. GSB 550, KS-128"
            className="code min-w-0 flex-1 px-3 text-[15px] text-slate-900 outline-none placeholder:text-slate-500"
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
    <Link to="/search?bulk=true" className="group flex flex-col justify-between gap-3 rounded-md bg-accent p-5 text-accent-fg">
      <span className="flex items-center gap-2">
        <Layers className="size-5 shrink-0" strokeWidth={1.9} />
        <span className="text-xl leading-tight font-extrabold">Buying in bulk?</span>
      </span>
      <span className="text-sm">Price breaks apply automatically in your cart. For larger orders, ask the seller for a quote.</span>
      <span className="inline-flex items-center gap-1 text-sm font-bold group-hover:underline">
        Shop bulk deals <ArrowRight className="size-4" />
      </span>
    </Link>
  )
}

/** No hero banners yet: the same editorial panel, with department photos as the plate. */
function FallbackHero({ siteName, tagline, tree }) {
  const tiles = tree.filter((d) => d.image?.url).slice(0, 4)
  return (
    <section className="grid gap-4 lg:min-h-[400px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
      <div className="flex flex-col justify-between gap-8 rounded-md bg-secondary p-7 text-secondary-fg sm:p-10 lg:p-11">
        <div className="flex flex-col gap-4">
          <span className="code text-xs tracking-widest text-accent uppercase">{siteName}</span>
          <h1 className="font-display text-[2.4rem] leading-[0.98] font-extrabold tracking-[-0.03em] [font-stretch:110%] sm:text-[3.1rem] lg:text-[3.4rem]">
            Tools, machinery and spare parts from reviewed sellers.
          </h1>
          {tagline && <p className="max-w-md text-[1.0625rem] leading-relaxed text-secondary-fg/75">{tagline}</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <a href="#departments" className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-bold text-accent-fg hover:brightness-[0.96]">
            Shop departments <ArrowRight className="size-4" />
          </a>
          <Link to="/search?bulk=true" className="inline-flex h-12 items-center rounded-md border-[1.5px] border-white/35 px-5 font-semibold hover:border-white/70">
            Bulk &amp; quotes
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(tiles.length ? tiles : tree.slice(0, 4)).map((d) => (
          <Link key={d._id} to={`/c/${d.slug}`} className="group relative overflow-hidden rounded-md bg-slate-100">
            <Thumb src={d.image?.url} alt="" fit="cover" className="aspect-square size-full transition-transform duration-500 group-hover:scale-[1.03]" />
            <span className="absolute inset-x-3 bottom-3 rounded-sm bg-white px-2.5 py-1.5 text-sm font-bold text-slate-900">{d.name}</span>
          </Link>
        ))}
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
                <Thumb src={dept.image?.url} alt="" className="size-20 rounded bg-slate-100" fit="cover" />
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

      <div className="mx-auto max-w-7xl px-4 pt-5 sm:px-6">
        {bannersLoading || treeLoading ? (
          <Skeleton className="h-[400px] w-full rounded-md" />
        ) : hero.length ? (
          <HeroCarousel banners={hero} />
        ) : (
          <FallbackHero siteName={siteName} tagline={settings?.branding?.tagline} tree={tree} />
        )}
      </div>
      <ServiceStrip className="mt-4" />
      <div className="mx-auto mt-4 grid max-w-7xl gap-4 px-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PartsFinder />
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

      <StatsBand siteName={siteName} className="mt-16" />

      <section className="mt-20 border-y border-slate-200 bg-slate-100">
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
