import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { flattenTree } from '@/core/lib/tree'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, Skeleton } from '@/ui/Card'
import { Combobox } from '@/ui/Combobox'
import { SegmentedControl, Switch } from '@/ui/Controls'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { moveItem, useReorder } from '@/ui/reorder'
import { adminApi, adminKeys } from '../api'

const homeKey = ['admin', 'home-sections']

/** Every kind of block, with what the admin sees. `single`: the page has at most one of it. */
const KINDS = {
  products: { label: 'Product row', help: 'Products from a source you pick: featured, bulk deals, new in, biggest discounts or a category.' },
  departmentRails: { label: 'Top departments', help: 'One product row per top-level department, in the category order.', single: true },
  partsFinder: { label: 'Parts finder & bulk callout', help: 'Search parts by machine model, next to the “Buying in bulk?” card.', single: true },
  offers: { label: 'Offer tiles', help: 'The “Home — offer tiles” banners (Banners page).', single: true },
  strip: { label: 'Promo strip', help: 'The “Home — promo strip” banner (Banners page).', single: true },
  brands: { label: 'Brands', help: 'Brands with live products.', single: true },
  stats: { label: 'Stats band', help: 'Products, sellers and categories on the site.', single: true },
  howItWorks: { label: 'How it works', help: 'Four reasons to buy here.', single: true },
  sellCta: { label: 'Sell with us', help: 'Invites dealers to open a store.', single: true },
}

const SOURCES = [
  { value: 'featured', label: 'Featured products' },
  { value: 'bulk', label: 'Bulk deals (has price breaks)' },
  { value: 'newest', label: 'New in (latest first)' },
  { value: 'discount', label: 'Biggest discounts' },
  { value: 'category', label: 'A category' },
]

const ROWS = [
  { value: '1', label: '1 row' },
  { value: '2', label: '2 rows' },
  { value: '3', label: '3 rows' },
]

const blank = (kind) => ({
  id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  enabled: true,
  title: '',
  subtitle: '',
  source: kind === 'products' ? 'category' : 'featured',
  category: null,
  rows: 1,
  shuffle: true,
  count: 3,
})

export default function HomeSectionsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: homeKey, queryFn: () => adminApi.homeSections() })
  const { data: tree = [] } = useQuery({ queryKey: adminKeys.categoryTree, queryFn: adminApi.categoryTree, staleTime: 60_000 })
  const categories = useMemo(() => flattenTree(tree), [tree])
  const [draft, setDraft] = useState(null)
  const [editing, setEditing] = useState(null) // { index, section } | { index: -1, section } for new
  const sections = draft ?? data?.sections ?? []
  const dirty = draft !== null
  const { tileProps, dragging, over } = useReorder(sections, setDraft)

  const save = useMutation({
    mutationFn: () => adminApi.saveHomeSections({ sections }),
    onSuccess: (saved) => {
      qc.setQueryData(homeKey, saved)
      setDraft(null)
      toast.success('Home page saved', { description: 'Visitors see the new layout on their next visit.' })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const update = (i, patch) => setDraft(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const remove = (i) => setDraft(sections.filter((_, j) => j !== i))
  const move = (i, dir) => setDraft(moveItem(sections, i, i + dir))
  const missing = Object.keys(KINDS).filter((k) => KINDS[k].single && !sections.some((s) => s.kind === k))

  const describe = (s) => {
    if (s.kind === 'products') {
      const src = s.source === 'category' ? categories.find((c) => c._id === s.category)?.path ?? 'Category (missing)' : SOURCES.find((x) => x.value === s.source)?.label
      return [src, `${s.rows} row${s.rows > 1 ? 's' : ''}`, s.shuffle ? 'shuffled' : 'in order'].join(' · ')
    }
    if (s.kind === 'departmentRails') return `${s.count} departments · ${s.rows} row${s.rows > 1 ? 's' : ''} each · ${s.shuffle ? 'shuffled' : 'in order'}`
    return KINDS[s.kind]?.help
  }

  return (
    <>
      <PageHeader
        title="Home page"
        description="Arrange what the storefront home page shows below the hero banner. Drag to reorder; hide blocks you don’t want."
        actions={
          <>
            {dirty && (
              <Button variant="outline" onClick={() => setDraft(null)}>
                Discard changes
              </Button>
            )}
            <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
              Save layout
            </Button>
          </>
        }
      />

      <p className="mb-4 text-sm text-slate-600">
        The hero banner and service strip always come first (manage the banner on the <Link to="/admin/banners" className="font-semibold underline">Banners</Link> page).
        Product rows are shuffled on every visit and a product already shown higher up isn’t repeated further down.
      </p>

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="flex flex-col gap-2">
          {sections.map((s, i) => (
            <Card
              key={s.id}
              {...tileProps(i)}
              className={cn(
                'flex items-center gap-3 p-3 transition-opacity',
                !s.enabled && 'opacity-60',
                dragging === i && 'opacity-40',
                over === i && dragging !== i && 'ring-2 ring-primary',
              )}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  {s.title || KINDS[s.kind]?.label}
                  {s.title && <Badge tone="neutral">{KINDS[s.kind]?.label}</Badge>}
                  {!s.enabled && <Badge tone="neutral">Hidden</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500">{describe(s)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === sections.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={s.enabled ? 'Hide' : 'Show'} onClick={() => update(i, { enabled: !s.enabled })}>
                  {s.enabled ? <Eye /> : <EyeOff />}
                </Button>
                {['products', 'departmentRails', 'brands'].includes(s.kind) && (
                  <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing({ index: i, section: s })}>
                    <Pencil />
                  </Button>
                )}
                <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            </Card>
          ))}

          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing({ index: -1, section: blank('products') })}>
              <Plus /> Add product row
            </Button>
            {missing.map((k) => (
              <Button key={k} variant="ghost" onClick={() => setDraft([...sections, blank(k)])}>
                <LayoutTemplate /> Add {KINDS[k].label.toLowerCase()}
              </Button>
            ))}
          </div>
        </div>
      )}

      <SectionDialog
        editing={editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSave={(section) => {
          setDraft(editing.index === -1 ? [...sections, section] : sections.map((s, j) => (j === editing.index ? section : s)))
          setEditing(null)
        }}
      />
    </>
  )
}

function SectionDialog({ editing, categories, onClose, onSave }) {
  const open = Boolean(editing)
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={editing?.index === -1 ? 'Add product row' : 'Edit section'} size="md">
      {/* Remount per section so the form starts from its values. */}
      {open && <SectionForm key={editing.section.id} initial={editing.section} categories={categories} onClose={onClose} onSave={onSave} />}
    </Dialog>
  )
}

function SectionForm({ initial, categories, onClose, onSave }) {
  const [s, setS] = useState(initial)
  const set = (patch) => setS((v) => ({ ...v, ...patch }))
  const options = categories.map((c) => ({ value: c._id, label: c.name, description: c.path, depth: c.depth }))
  const needsCategory = s.kind === 'products' && s.source === 'category' && !s.category
  const isProducts = s.kind === 'products' || s.kind === 'departmentRails'

  return (
    <div className="flex flex-col gap-4">
      {s.kind !== 'departmentRails' && (
        <Field label="Heading" hint={s.kind === 'products' && s.source === 'category' ? 'Leave empty to use the category name' : undefined}>
          {(p) => <Input {...p} value={s.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />}
        </Field>
      )}
      {s.kind === 'products' && (
        <>
          <Field label="Subheading (optional)">{(p) => <Input {...p} value={s.subtitle} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} />}</Field>
          <Field label="Products from">
            {(p) => (
              <Select {...p} value={s.source} onChange={(e) => set({ source: e.target.value })}>
                {SOURCES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {s.source === 'category' && (
            <Field label="Category" required error={needsCategory ? 'Pick a category' : undefined} hint="Includes everything in its sub-categories">
              {() => <Combobox options={options} value={s.category ?? ''} onChange={(v) => set({ category: v || null })} placeholder="Choose a category…" />}
            </Field>
          )}
        </>
      )}
      {s.kind === 'departmentRails' && (
        <Field label="How many departments" hint="The first ones in the category order, one row each">
          {(p) => <Input {...p} type="number" min={1} max={12} value={s.count} onChange={(e) => set({ count: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />}
        </Field>
      )}
      {isProducts && (
        <>
          <Field label="Rows" hint="More rows show more products; all rows scroll sideways together">
            {() => <SegmentedControl value={String(s.rows)} onChange={(v) => set({ rows: Number(v) })} options={ROWS} />}
          </Field>
          <Switch
            checked={s.shuffle}
            onCheckedChange={(shuffle) => set({ shuffle })}
            label="Shuffle products on every visit"
            description="Off keeps the source’s own order (e.g. newest first)."
          />
        </>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={needsCategory} onClick={() => onSave(s)}>
          Done
        </Button>
      </div>
    </div>
  )
}
