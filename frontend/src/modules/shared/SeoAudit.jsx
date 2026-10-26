import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, ExternalLink, Pencil, Sparkles, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSearchParamsState } from '@/core/hooks/useSearchParamsState'
import { cn } from '@/core/lib/cn'
import { formatNumber } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { DataTable, Pagination, pageSize } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Select, Textarea } from '@/ui/Field'
import { TagInput } from '@/ui/inputs'
import { PageHeader, StatCard } from '@/ui/PageHeader'
import { SearchField } from '@/ui/SearchField'
import { GooglePreview, LengthHint, SEO_LIMITS } from './seo'

const scoreTone = (s) => (s >= 80 ? 'success' : s >= 50 ? 'warning' : 'danger')

/**
 * SEO improvements: every product scored, worst first, with what to fix and suggested text to fix it with.
 * `client`: { root, audit(params), site?(), updateProduct(id, body), editPath(id) }. Admins also get site-wide checks.
 */
export function SeoAuditPage({ client, showSeller = false }) {
  const [filters, setFilters] = useSearchParamsState()
  const [fixing, setFixing] = useState(null)
  const params = { page: Number(filters.page ?? 1), limit: pageSize(filters.limit), issue: filters.issue || undefined, q: filters.q || undefined }
  const { data, isLoading } = useQuery({ queryKey: [...client.root, 'seo-audit', params], queryFn: () => client.audit(params), placeholderData: keepPreviousData })
  const summary = data?.meta?.summary
  const checks = data?.meta?.checks ?? {}

  return (
    <>
      <PageHeader
        title="SEO improvements"
        description="What to change so your products rank better on Google and look better when shared. Fix the lowest scores first."
      />
      {client.site && <SiteChecks client={client} />}
      {!summary ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Average SEO score" value={`${summary.averageScore}/100`} hint={`${formatNumber(summary.products)} products checked`} icon={Sparkles} />
          <StatCard label="Good (80+)" value={formatNumber(summary.good)} icon={CheckCircle2} />
          <StatCard label="Needs work (50–79)" value={formatNumber(summary.needsWork)} icon={CircleAlert} tone="warning" />
          <StatCard label="Poor (under 50)" value={formatNumber(summary.poor)} icon={CircleAlert} tone="warning" />
        </div>
      )}
      {summary && (
        <div className="mb-4 flex flex-wrap gap-2">
          {Object.entries(summary.issues)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([key, n]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilters({ issue: filters.issue === key ? undefined : key })}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                  filters.issue === key ? 'border-primary bg-primary text-primary-fg' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500',
                )}
              >
                {checks[key]?.label} · {n}
              </button>
            ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchField value={filters.q ?? ''} onChange={(q) => setFilters({ q })} placeholder="Product name" />
          <Select value={filters.issue ?? ''} onChange={(e) => setFilters({ issue: e.target.value })} className="w-auto">
            <option value="">Every issue</option>
            {Object.entries(checks).map(([key, c]) => (
              <option key={key} value={key}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          loading={isLoading}
          rows={data?.items}
          empty={{ title: 'Nothing to fix here', description: 'Every product matching these filters looks good.' }}
          columns={[
            {
              key: 'product',
              header: 'Product',
              cell: (p) => (
                <div className="flex items-center gap-3">
                  <Thumb src={p.image} className="size-10 shrink-0 rounded border border-slate-200" />
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">{[p.category, showSeller && p.seller, p.status !== 'active' && p.status].filter(Boolean).join(' · ')}</p>
                  </div>
                </div>
              ),
            },
            { key: 'score', header: 'Score', cell: (p) => <Badge tone={scoreTone(p.score)}>{p.score}</Badge> },
            {
              key: 'issues',
              header: 'What to improve',
              cell: (p) =>
                p.issues.length ? (
                  <ul className="max-w-md space-y-0.5 text-xs text-slate-700">
                    {p.issues.slice(0, 4).map((k) => (
                      <li key={k} title={checks[k]?.tip}>
                        • {checks[k]?.label}
                      </li>
                    ))}
                    {p.issues.length > 4 && <li className="text-slate-500">+{p.issues.length - 4} more</li>}
                  </ul>
                ) : (
                  <span className="text-xs font-semibold text-emerald-700">All good</span>
                ),
            },
            {
              key: 'actions',
              header: '',
              className: 'w-px whitespace-nowrap',
              cell: (p) => (
                <div className="flex gap-1">
                  {p.issues.length > 0 && (
                    <Button size="sm" onClick={() => setFixing(p)}>
                      <Wand2 /> Fix
                    </Button>
                  )}
                  <Button asChild size="icon-sm" variant="ghost" title="Open the full product">
                    <Link to={client.editPath(p._id)} aria-label={`Edit ${p.name}`}>
                      <Pencil />
                    </Link>
                  </Button>
                </div>
              ),
            },
          ]}
        />
        <Pagination meta={data?.meta} onPageChange={(page) => setFilters({ page })} onLimitChange={(limit) => setFilters({ limit })} />
      </Card>
      <FixDialog product={fixing} checks={checks} client={client} onClose={() => setFixing(null)} />
    </>
  )
}

function SiteChecks({ client }) {
  const { data } = useQuery({ queryKey: [...client.root, 'seo-audit', 'site'], queryFn: client.site })
  if (!data) return null
  return (
    <div className="mb-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Storefront checks" />
        <CardBody>
          <ul className="space-y-3">
            {data.checks.map((c) => (
              <li key={c.key} className="flex gap-3 text-sm">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                <span>
                  <span className="font-medium text-slate-900">{c.label}</span>
                  {!c.ok && <span className="block text-xs text-slate-600">{c.tip}</span>}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Categories to improve" description={`${data.categoriesWithIssues} of ${data.categoriesTotal} live categories`} />
        <CardBody>
          {data.categories.length ? (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-sm">
              {data.categories.map((c) => (
                <li key={c._id} className="flex items-start justify-between gap-3 py-2">
                  <span>
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <span className="block text-xs text-slate-500">{c.issues.join(' · ')}</span>
                  </span>
                  <a href={`/c/${c.slug}`} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-slate-700" aria-label={`View ${c.name}`}>
                    <ExternalLink className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-emerald-700">Every category has a description and an image.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

/** Quick fix: the text fields Google reads, with suggestions one tap away. Photos and specs need the full product form. */
function FixDialog({ product, checks, client, onClose }) {
  return (
    <Dialog open={Boolean(product)} onOpenChange={(o) => !o && onClose()} size="xl" title="Improve SEO" description={product?.name}>
      {product && <FixForm key={product._id} product={product} checks={checks} client={client} onDone={onClose} />}
    </Dialog>
  )
}

function FixForm({ product, checks, client, onDone }) {
  const qc = useQueryClient()
  const s = product.suggestion ?? {}
  const [v, setV] = useState(product.current)
  const save = useMutation({
    mutationFn: () =>
      client.updateProduct(product._id, {
        shortDescription: v.shortDescription.trim() || undefined,
        searchKeywords: v.searchKeywords,
        seo: {
          title: v.seoTitle.trim() || undefined,
          description: v.seoDescription.trim() || undefined,
          ogTitle: v.ogTitle?.trim() || undefined,
          ogDescription: v.ogDescription?.trim() || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...client.root, 'seo-audit'] })
      toast.success('SEO updated')
      onDone()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const suggestionLink = (field) =>
    s[field] != null && (
      <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setV((x) => ({ ...x, [field]: s[field] }))}>
        Use suggestion
      </button>
    )
  const manual = product.issues.filter((k) => !checks[k]?.fix)

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Field label="Title tag" labelAction={suggestionLink('seoTitle')} hint={<LengthHint text={v.seoTitle || product.effective.title} limits={SEO_LIMITS.title} />}>
          {(p) => <Input {...p} value={v.seoTitle} placeholder={s.seoTitle ?? product.effective.title} maxLength={160} onChange={(e) => setV({ ...v, seoTitle: e.target.value })} />}
        </Field>
        <Field label="Meta description" labelAction={suggestionLink('seoDescription')} hint={<LengthHint text={v.seoDescription || v.shortDescription} limits={SEO_LIMITS.description} />}>
          {(p) => <Textarea {...p} rows={3} value={v.seoDescription} placeholder={s.seoDescription} maxLength={320} onChange={(e) => setV({ ...v, seoDescription: e.target.value })} />}
        </Field>
        <Field label="Short description" labelAction={suggestionLink('shortDescription')} hint="One line shown near the price.">
          {(p) => <Textarea {...p} rows={2} value={v.shortDescription} placeholder={s.shortDescription} maxLength={500} onChange={(e) => setV({ ...v, shortDescription: e.target.value })} />}
        </Field>
        <Field
          label="Search keywords"
          labelAction={
            s.searchKeywords && (
              <button
                type="button"
                className="text-xs font-semibold text-primary hover:underline"
                onClick={() => setV((x) => ({ ...x, searchKeywords: [...new Set([...x.searchKeywords, ...s.searchKeywords])].slice(0, 30) }))}
              >
                Add suggested
              </button>
            )
          }
        >
          {() => <TagInput value={v.searchKeywords} onChange={(searchKeywords) => setV({ ...v, searchKeywords })} max={30} placeholder="e.g. 3hp petrol water pump" />}
        </Field>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
      <aside className="space-y-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Google preview</p>
          <GooglePreview url={`${window.location.origin}/p/${product.slug}`} title={v.seoTitle || product.effective.title} description={v.seoDescription || v.shortDescription || s.seoDescription} />
        </div>
        {manual.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="mb-1 font-semibold text-amber-900">Also fix in the full product form</p>
            <ul className="space-y-1.5 text-xs text-amber-900">
              {manual.map((k) => (
                <li key={k}>
                  <span className="font-semibold">{checks[k].label}:</span> {checks[k].tip}
                </li>
              ))}
            </ul>
            <Link to={client.editPath(product._id)} className="mt-2 inline-block text-xs font-semibold text-primary hover:underline">
              Open product
            </Link>
          </div>
        )}
      </aside>
    </div>
  )
}
