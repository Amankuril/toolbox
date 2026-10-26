import { useQuery } from '@tanstack/react-query'
import { FileQuestion, Mail, MessageCircle, Phone } from 'lucide-react'
import { useParams } from 'react-router'
import { useBranding } from '@/core/settings/usePublicSettings'
import { EmptyState, Skeleton } from '@/ui/Card'
import { RichText } from '@/ui/RichText'
import { whatsappLink } from '@/modules/shared/whatsapp'
import { storeApi, storeKeys } from '../api'

/** Terms, privacy, cancellation and support pages, as written in Admin → Pages. */
export default function ContentPage() {
  const { slug } = useParams()
  const { siteName, supportEmail, supportPhone } = useBranding()
  const { data: page, isLoading, error } = useQuery({ queryKey: storeKeys.page(slug), queryFn: () => storeApi.page(slug), retry: false })

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-80" />
      </div>
    )
  }
  if (error || !page) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={FileQuestion} title="Page not found" description="This page may have moved or been taken down." />
      </div>
    )
  }
  const description = page.seo.description ?? page.content.replace(/[#*]/g, '').slice(0, 160)
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <title>{`${page.seo.title ?? page.title} | ${siteName}`}</title>
      <meta name="description" content={description} />
      <p className="eyebrow">{siteName}</p>
      <h1 className="mt-1 mb-8 font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">{page.title}</h1>
      {page.key === 'support' && (supportPhone || supportEmail) && (
        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          {supportPhone && (
            <a href={`tel:${supportPhone.replace(/\s/g, '')}`} className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 hover:border-primary">
              <Phone className="size-5 text-primary" />
              <span className="text-sm font-semibold text-slate-900">{supportPhone}</span>
            </a>
          )}
          {supportPhone && (
            <a href={whatsappLink(supportPhone, `Hi ${siteName}, I need help with `)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 hover:border-primary">
              <MessageCircle className="size-5 text-[#128c4b]" />
              <span className="text-sm font-semibold text-slate-900">Chat on WhatsApp</span>
            </a>
          )}
          {supportEmail && (
            <a href={`mailto:${supportEmail}`} className="flex items-center gap-3 rounded-lg border border-slate-200 p-4 hover:border-primary">
              <Mail className="size-5 text-primary" />
              <span className="truncate text-sm font-semibold text-slate-900">{supportEmail}</span>
            </a>
          )}
        </div>
      )}
      <RichText text={page.content} />
    </article>
  )
}
