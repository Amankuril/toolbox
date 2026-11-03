import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, Sparkles, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useWatch } from 'react-hook-form'
import { useDebounce } from '@/core/hooks/useDebounce'
import { cn } from '@/core/lib/cn'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'

const FIELDS = ['name', 'brand', 'modelNumber', 'shortDescription', 'description', 'category', 'media', 'specifications', 'tags', 'searchKeywords', 'pricing.price', 'seo']

/** The form's values in the shape the SEO checks read. */
function draftOf(values, productId) {
  const [name, brand, modelNumber, shortDescription, description, category, media, specifications, tags, searchKeywords, price, seo] = values
  return {
    productId,
    name: name ?? '',
    brand: brand ?? '',
    modelNumber: modelNumber ?? '',
    shortDescription: shortDescription ?? '',
    description: description ?? '',
    category: category || null,
    images: (media ?? []).filter((m) => m.kind === 'image').map((m) => ({ alt: m.item.alt ?? '' })),
    specifications: (specifications ?? []).filter((s) => s.label?.trim() && s.value?.trim()).map(({ label, value }) => ({ label, value })),
    tags: tags ?? [],
    searchKeywords: searchKeywords ?? [],
    pricing: Number.isInteger(price) ? { price } : undefined,
    seo: { title: seo?.title ?? '', description: seo?.description ?? '' },
  }
}

const tone = (score) => (score >= 80 ? 'text-emerald-700 bg-emerald-50 ring-emerald-200' : score >= 50 ? 'text-amber-800 bg-amber-50 ring-amber-200' : 'text-red-700 bg-red-50 ring-red-200')

/**
 * Live SEO score for the product being written, with the same checks and suggestions as the SEO
 * improvements page, so problems get fixed before the product is saved rather than after.
 *
 * @param {{ control: any, setValue: Function, getValues: Function, productId?: string, preview: (draft) => Promise<any> }} props
 */
export function SeoLiveCheck({ control, setValue, getValues, productId, preview }) {
  const values = useWatch({ control, name: FIELDS })
  const draft = useDebounce(JSON.stringify(draftOf(values, productId)), 700)
  const [open, setOpen] = useState(true)
  const { data, isFetching } = useQuery({
    queryKey: ['seo-preview', draft],
    queryFn: () => preview(JSON.parse(draft)),
    enabled: Boolean(JSON.parse(draft).name.trim()),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const put = (name, value) => setValue(name, value, { shouldDirty: true, shouldValidate: true })
  const s = data?.suggestion
  // What one tap can fill in, per issue.
  const fixes = {
    title_long: s && { label: 'Use suggested title', apply: () => put('seo', { ...getValues('seo'), title: s.seoTitle }), preview: s.seoTitle },
    title_short: s && { label: 'Use suggested title', apply: () => put('seo', { ...getValues('seo'), title: s.seoTitle }), preview: s.seoTitle },
    meta_missing: s && { label: 'Use suggested description', apply: () => put('seo', { ...getValues('seo'), description: s.seoDescription }), preview: s.seoDescription },
    meta_short: s && { label: 'Use suggested description', apply: () => put('seo', { ...getValues('seo'), description: s.seoDescription }), preview: s.seoDescription },
    meta_long: s && { label: 'Use suggested description', apply: () => put('seo', { ...getValues('seo'), description: s.seoDescription }), preview: s.seoDescription },
    no_short_description: s && { label: 'Use suggested summary', apply: () => put('shortDescription', s.shortDescription), preview: s.shortDescription },
    no_keywords: s?.searchKeywords?.length && {
      label: 'Add suggested keywords',
      apply: () => put('searchKeywords', [...new Set([...(getValues('searchKeywords') ?? []), ...s.searchKeywords])].slice(0, 30)),
      preview: s.searchKeywords.join(', '),
    },
  }
  // Keywords help even when some are already there.
  const extraKeywords = s?.searchKeywords?.filter((k) => !(values[9] ?? []).includes(k)) ?? []

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> SEO check
          </span>
        }
        description="Updates as you type. Fix these now so the product ranks from day one."
        action={
          data && (
            <span className={cn('rounded-full px-2.5 py-1 text-sm font-bold tabular ring-1 ring-inset transition-opacity', tone(data.score), isFetching && 'opacity-60')}>
              {data.score}/100
            </span>
          )
        }
      />
      <CardBody className="flex flex-col gap-3">
        {!data ? (
          <p className="text-sm text-slate-500">Type the product name to see what to improve.</p>
        ) : data.issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <Check className="size-4" /> Everything we check looks good.
          </p>
        ) : (
          <>
            <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between text-left text-sm font-semibold text-slate-800">
              {data.issues.length} thing{data.issues.length === 1 ? '' : 's'} to improve
              <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
            </button>
            {open && (
              <ul className="flex flex-col divide-y divide-slate-100">
                {data.issues
                  .slice()
                  .sort((a, b) => b.weight - a.weight)
                  .map((issue) => {
                    const fix = fixes[issue.key]
                    return (
                      <li key={issue.key} className="py-2.5 first:pt-0">
                        <p className="flex items-start justify-between gap-2 text-sm font-medium text-slate-900">
                          {issue.label}
                          <span className="shrink-0 text-xs font-normal text-slate-400 tabular">−{issue.weight}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">{issue.tip}</p>
                        {fix && (
                          <div className="mt-2 rounded-md bg-slate-50 p-2">
                            <p className="line-clamp-3 text-xs text-slate-700">“{fix.preview}”</p>
                            <Button size="xs" variant="soft" className="mt-1.5" onClick={fix.apply}>
                              <Wand2 /> {fix.label}
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
              </ul>
            )}
          </>
        )}
        {data && !data.issues.some((i) => i.key === 'no_keywords') && extraKeywords.length > 0 && (
          <div className="rounded-md border border-dashed border-slate-200 p-2">
            <p className="text-xs font-medium text-slate-700">More keywords buyers search for</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {extraKeywords.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => put('searchKeywords', [...(getValues('searchKeywords') ?? []), k].slice(0, 30))}
                  className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200 hover:ring-primary"
                >
                  + {k}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
