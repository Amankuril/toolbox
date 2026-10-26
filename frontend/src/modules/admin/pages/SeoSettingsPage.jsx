import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { fillTemplate } from '@/core/seo/templates'
import { publicSettingsKey } from '@/core/settings/usePublicSettings'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { Tabs } from '@/ui/Controls'
import { Field, Input, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { PageHeader } from '@/ui/PageHeader'
import { GooglePreview, LengthHint, SEO_LIMITS, SeoFields, SharePreview } from '@/modules/shared/seo'
import { useAdminAccess } from '../access'
import { adminApi, adminKeys } from '../api'

const SAMPLES = {
  product: { name: 'NB-WP-15 1.5-Inch 3HP Petrol Water Pump', brand: 'Neptune', price: '₹8,499', category: 'Water pumps' },
  category: { name: 'Water pumps' },
  store: { name: 'Arihant Trading Company', city: ' (Budhana, Uttar Pradesh)' },
}
const PLACEHOLDERS = {
  product: '{name} {brand} {price} {category} {site}',
  category: '{name} {site}',
  store: '{name} {city} {site}',
}

/** Search engine and social share titles for the whole storefront. Pages with their own SEO fields keep them. */
export default function SeoSettingsPage() {
  const { data, isLoading } = useQuery({ queryKey: adminKeys.settings, queryFn: adminApi.settings })
  if (isLoading || !data) return <Skeleton className="h-96" />
  return <SeoForm key={data.seo ? JSON.stringify(data.seo) : 'none'} settings={data} />
}

function SeoForm({ settings }) {
  const qc = useQueryClient()
  const canEdit = useAdminAccess().can('settings', 'manage')
  const site = settings.branding.siteName
  const [seo, setSeo] = useState(settings.seo)
  const [tab, setTab] = useState('home')
  const set = (group, patch) => setSeo((s) => ({ ...s, [group]: { ...s[group], ...patch } }))
  const save = useMutation({
    mutationFn: () =>
      adminApi.updateSettings('seo', {
        ...seo,
        home: { ...seo.home, ogImage: seo.home.ogImage ? { media: seo.home.ogImage.media, alt: seo.home.ogImage.alt } : null },
      }),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data)
      qc.invalidateQueries({ queryKey: publicSettingsKey })
      toast.success('SEO settings saved')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const origin = window.location.origin
  const home = seo.home

  return (
    <>
      <PageHeader
        title="SEO settings"
        description="How the storefront appears on Google and when links are shared on WhatsApp or Facebook. Allow some time for changes to show on Google."
        actions={
          canEdit && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              <Save /> Save
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'home', label: 'Home page' },
          { value: 'product', label: 'Product pages' },
          { value: 'category', label: 'Category pages' },
          { value: 'store', label: 'Seller stores' },
        ]}
      />
      <div className="mt-6">
        {tab === 'home' ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader title="General" description="Title tag and meta description for the home page. {site} is your store name." />
              <CardBody className="flex flex-col gap-5">
                <SeoFields value={home} onChange={(v) => set('home', v)} url={origin} placeholder={{ title: site }} />
                <Field label="Meta keywords" hint="Comma separated. Most search engines ignore these, but some marketplaces read them.">
                  {(p) => <Input {...p} value={home.keywords} maxLength={500} onChange={(e) => set('home', { keywords: e.target.value })} />}
                </Field>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Social share" description="Open Graph (og) tags: what Facebook and WhatsApp show when your home page is shared." />
              <CardBody className="grid gap-5 lg:grid-cols-2">
                <div className="flex flex-col gap-4">
                  <Field label="og:title" hint={<LengthHint text={home.ogTitle} limits={SEO_LIMITS.ogTitle} />}>
                    {(p) => <Input {...p} value={home.ogTitle} maxLength={SEO_LIMITS.ogTitle.hard} placeholder={fillTemplate(home.title, { site })} onChange={(e) => set('home', { ogTitle: e.target.value })} />}
                  </Field>
                  <Field label="og:description" hint={<LengthHint text={home.ogDescription} limits={SEO_LIMITS.ogDescription} />}>
                    {(p) => (
                      <Textarea
                        {...p}
                        rows={4}
                        value={home.ogDescription}
                        maxLength={SEO_LIMITS.ogDescription.hard}
                        placeholder={fillTemplate(home.description, { site })}
                        onChange={(e) => set('home', { ogDescription: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Share image" hint="1200×630 works best. Empty = your storefront logo.">
                    {() => (
                      <ImageUploader
                        audience="admin"
                        folder="branding"
                        max={1}
                        aspect="aspect-[1.91/1]"
                        gridClassName="grid-cols-1"
                        value={home.ogImage ? [home.ogImage] : []}
                        onChange={(imgs) => set('home', { ogImage: imgs[0] ?? null })}
                        compact
                        label="Upload image"
                      />
                    )}
                  </Field>
                </div>
                <div className="self-start rounded-lg bg-slate-50 p-4">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">WhatsApp preview</p>
                  <SharePreview
                    url={origin}
                    title={home.ogTitle || fillTemplate(home.title, { site })}
                    description={home.ogDescription || fillTemplate(home.description, { site })}
                    image={home.ogImage?.url}
                  />
                </div>
              </CardBody>
            </Card>
          </div>
        ) : (
          <TemplateCard kind={tab} value={seo[tab]} onChange={(v) => set(tab, v)} site={site} />
        )}
      </div>
    </>
  )
}

function TemplateCard({ kind, value, onChange, site }) {
  const vars = { site, ...SAMPLES[kind] }
  const label = { product: 'product', category: 'category', store: 'seller store' }[kind]
  return (
    <Card>
      <CardHeader
        title={`Default for every ${label} page`}
        description={`Used when a ${label} has no SEO title or description of its own. Fill-ins: ${PLACEHOLDERS[kind]}`}
      />
      <CardBody className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field label="Title tag template">{(p) => <Input {...p} value={value.title} maxLength={160} onChange={(e) => onChange({ ...value, title: e.target.value })} />}</Field>
          <Field label="Meta description template">
            {(p) => <Textarea {...p} rows={4} value={value.description} maxLength={320} onChange={(e) => onChange({ ...value, description: e.target.value })} />}
          </Field>
        </div>
        <div className="self-start rounded-lg bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Example: Google preview</p>
          <GooglePreview url={window.location.origin} title={fillTemplate(value.title, vars)} description={fillTemplate(value.description, vars)} />
          <div className="mt-3 space-y-1">
            <LengthHint text={fillTemplate(value.title, vars)} limits={SEO_LIMITS.title} />
            <LengthHint text={fillTemplate(value.description, vars)} limits={SEO_LIMITS.description} />
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
