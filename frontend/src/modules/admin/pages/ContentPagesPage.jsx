import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, RotateCcw, Save } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { formatDateTime } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { SegmentedControl, Switch } from '@/ui/Controls'
import { ConfirmDialog } from '@/ui/Dialog'
import { Field, Input, Textarea } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { RichText } from '@/ui/RichText'
import { SeoFields } from '@/modules/shared/seo'
import { useAdminAccess } from '../access'
import { adminApi, adminKeys } from '../api'

/** Terms, privacy, cancellation and support pages: written here, shown on the storefront and linked in its footer. */
export default function ContentPagesPage() {
  const { data: pages, isLoading } = useQuery({ queryKey: adminKeys.pages, queryFn: adminApi.pages })
  const [selected, setSelected] = useState('terms')
  const page = pages?.find((p) => p.key === selected)

  return (
    <>
      <PageHeader title="Pages" description="Policy and help pages on the storefront. They are linked in the footer of every page." />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <Card className="self-start">
          <ul className="p-2">
            {isLoading
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="m-2 h-10" />)
              : pages.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(p.key)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm',
                        p.key === selected ? 'bg-primary/10 font-semibold text-primary' : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <FileText className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      {!p.published && <Badge tone="warning">Hidden</Badge>}
                    </button>
                  </li>
                ))}
          </ul>
        </Card>
        {page ? <PageEditor key={`${page.key}:${page.updatedAt}`} page={page} /> : <Skeleton className="h-96" />}
      </div>
    </>
  )
}

function PageEditor({ page }) {
  const qc = useQueryClient()
  const canEdit = useAdminAccess().can('content', 'manage')
  const [form, setForm] = useState({ title: page.title, content: page.content, published: page.published, seo: page.seo })
  const [view, setView] = useState('write')
  const [resetting, setResetting] = useState(false)
  const dirty = form.title !== page.title || form.content !== page.content || form.published !== page.published || JSON.stringify(form.seo) !== JSON.stringify(page.seo)

  const onSaved = (saved) => {
    qc.setQueryData(adminKeys.pages, (list) => list?.map((p) => (p.key === saved.key ? saved : p)))
  }
  const save = useMutation({
    mutationFn: () =>
      adminApi.savePage(page.key, {
        title: form.title,
        content: form.content,
        published: form.published,
        seo: { title: form.seo.title || undefined, description: form.seo.description || undefined },
      }),
    onSuccess: (saved) => {
      onSaved(saved)
      toast.success('Page saved')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  const reset = useMutation({
    mutationFn: () => adminApi.resetPage(page.key),
    onSuccess: (saved) => {
      onSaved(saved)
      toast.success('Back to the starting text')
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const url = `${window.location.origin}/pages/${page.slug}`
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={page.title}
          description={page.customised ? `Last saved ${formatDateTime(page.updatedAt)}` : 'Starting text: edit it to make it yours.'}
          action={
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> View
              </a>
            </Button>
          }
        />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Page title">{(p) => <Input {...p} value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
            <Switch label="Show on the storefront" checked={form.published} onCheckedChange={(published) => setForm({ ...form, published })} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: 'write', label: 'Write' },
                { value: 'preview', label: 'Preview' },
              ]}
            />
            <p className="text-xs text-slate-500">
              <code>## Heading</code> · <code>- list item</code> · <code>**bold**</code> · blank line = new paragraph
            </p>
          </div>
          {view === 'write' ? (
            <Textarea rows={22} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="font-mono text-sm" aria-label="Page content" />
          ) : (
            <div className="min-h-96 rounded-md border border-slate-200 p-5">
              <h1 className="mb-4 font-display text-2xl font-extrabold text-slate-900">{form.title}</h1>
              <RichText text={form.content} />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Search engine listing" description="What Google shows for this page. Left empty, the page title and first lines are used." />
        <CardBody>
          <SeoFields value={form.seo} onChange={(seo) => setForm({ ...form, seo })} placeholder={{ title: form.title, description: form.content.replace(/[#*-]/g, '').slice(0, 160) }} url={url} />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap justify-end gap-2">
          {page.customised && (
            <Button variant="ghost" onClick={() => setResetting(true)}>
              <RotateCcw /> Restore starting text
            </Button>
          )}
          <Button loading={save.isPending} disabled={!dirty || !form.title.trim()} onClick={() => save.mutate()}>
            <Save /> Save page
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={resetting}
        onOpenChange={setResetting}
        title="Restore the starting text?"
        description="Your text for this page is replaced by the default one. This cannot be undone."
        confirmLabel="Restore"
        onConfirm={() => reset.mutateAsync()}
      />
    </div>
  )
}
