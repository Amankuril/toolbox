import { CheckCircle2, CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/core/lib/cn'
import { Field, Input, Textarea } from '@/ui/Field'

/** Lengths Google shows in full on most screens. */
export const SEO_LIMITS = {
  title: { min: 30, max: 60, hard: 160 },
  description: { min: 70, max: 160, hard: 320 },
  ogTitle: { min: 20, max: 90, hard: 120 },
  ogDescription: { min: 50, max: 200, hard: 300 },
}

/** "60 characters. Great!" / "Too short" / "Too long", like the length guides in Shopify-style SEO editors. */
export function lengthVerdict(text, { min, max }) {
  const n = String(text ?? '').trim().length
  if (!n) return { tone: 'muted', message: 'Empty: the default is used' }
  if (n < min) return { tone: 'warn', message: `${n} characters. Too short, aim for ${min}–${max}.` }
  if (n > max) return { tone: 'warn', message: `${n} characters. Too long, Google may cut it after ${max}.` }
  return { tone: 'good', message: `${n} characters. Great!` }
}

export function LengthHint({ text, limits }) {
  const v = lengthVerdict(text, limits)
  return (
    <span className={cn('flex items-center gap-1.5 text-xs', v.tone === 'good' ? 'text-emerald-700' : v.tone === 'warn' ? 'text-amber-700' : 'text-slate-500')}>
      {v.tone === 'good' ? <CheckCircle2 className="size-3.5" /> : v.tone === 'warn' ? <CircleAlert className="size-3.5" /> : null}
      {v.message}
    </span>
  )
}

/** How the page might look as a Google result. */
export function GooglePreview({ url, title, description }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="truncate text-xs text-slate-600">{url}</p>
      <p className="mt-1 line-clamp-2 text-lg leading-snug text-[#1a0dab]">{title || 'Page title'}</p>
      <p className="mt-1 line-clamp-3 text-sm text-slate-600">{description || 'The description shown under the title in search results.'}</p>
    </div>
  )
}

/** How a shared link might look in WhatsApp / Facebook. */
export function SharePreview({ url, title, description, image }) {
  return (
    <div className="overflow-hidden rounded-lg border border-emerald-200 bg-[#d9fdd3]">
      {image && <img src={image} alt="" className="aspect-[1.91/1] w-full object-cover" />}
      <div className="space-y-0.5 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-slate-900">{title || 'Title'}</p>
        <p className="line-clamp-2 text-xs text-slate-600">{description || 'Description'}</p>
        <p className="truncate text-xs text-sky-700">{url}</p>
      </div>
    </div>
  )
}

/**
 * Title + description inputs with length guides and a Google preview.
 * `value` is { title, description }; `placeholder` the same shape for what's used when left empty.
 */
export function SeoFields({ value, onChange, placeholder = {}, url, showPreview = true }) {
  const v = value ?? {}
  const set = (key) => (e) => onChange({ ...v, [key]: e.target.value })
  return (
    <div className={cn('grid gap-5', showPreview && 'lg:grid-cols-2')}>
      <div className="space-y-4">
        <Field label="Title tag" hint={<LengthHint text={v.title || placeholder.title} limits={SEO_LIMITS.title} />}>
          {(p) => <Input {...p} value={v.title ?? ''} onChange={set('title')} placeholder={placeholder.title} maxLength={SEO_LIMITS.title.hard} />}
        </Field>
        <Field label="Meta description" hint={<LengthHint text={v.description || placeholder.description} limits={SEO_LIMITS.description} />}>
          {(p) => <Textarea {...p} rows={4} value={v.description ?? ''} onChange={set('description')} placeholder={placeholder.description} maxLength={SEO_LIMITS.description.hard} />}
        </Field>
      </div>
      {showPreview && (
        <div className="self-start rounded-lg bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Google preview</p>
          <GooglePreview url={url} title={v.title || placeholder.title} description={v.description || placeholder.description} />
        </div>
      )}
    </div>
  )
}

/**
 * A product's own search and share text, in two tabs like the screenshots sellers know from other store builders.
 * `value` is { title, description, ogTitle, ogDescription }; empty fields fall back to `defaults`.
 */
export function ProductSeoCard({ value, onChange, defaults, url, image }) {
  const [tab, setTab] = useState('general')
  const v = value ?? {}
  const set = (key) => (e) => onChange({ ...v, [key]: e.target.value })
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-slate-200">
        {[
          { value: 'general', label: 'General' },
          { value: 'social', label: 'Social share' },
        ].map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold', tab === t.value ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-800')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'general' ? (
        <>
          <p className="mb-4 text-sm text-slate-600">Optimise your product with relevant keywords to drive traffic and boost sales. Allow some time for updates to appear on Google.</p>
          <SeoFields value={{ title: v.title, description: v.description }} onChange={(next) => onChange({ ...v, ...next })} placeholder={defaults} url={url} />
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-600">Open graph (og) tags are used by social networks like Facebook &amp; WhatsApp to show text and an image when this page is shared.</p>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <Field label="og:title" hint={`(${(v.ogTitle ?? '').length}/${SEO_LIMITS.ogTitle.hard})`}>
                {(p) => <Input {...p} value={v.ogTitle ?? ''} onChange={set('ogTitle')} placeholder={v.title || defaults.title} maxLength={SEO_LIMITS.ogTitle.hard} />}
              </Field>
              <Field label="og:description" hint={`(${(v.ogDescription ?? '').length}/${SEO_LIMITS.ogDescription.hard})`}>
                {(p) => (
                  <Textarea {...p} rows={4} value={v.ogDescription ?? ''} onChange={set('ogDescription')} placeholder={v.description || defaults.description} maxLength={SEO_LIMITS.ogDescription.hard} />
                )}
              </Field>
            </div>
            <div className="self-start rounded-lg bg-slate-50 p-4">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Preview</p>
              <SharePreview
                url={url}
                image={image}
                title={v.ogTitle || v.title || defaults.title}
                description={v.ogDescription || v.description || defaults.description}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
