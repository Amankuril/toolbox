import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FolderPlus, FolderTree, Pencil, Plus, Share2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { buildTree } from '@/core/lib/tree'
import { StatusBadge } from '@/ui/Badge'
import { Thumb } from '@/ui/Brand'
import { Button } from '@/ui/Button'
import { Card, CardHeader, EmptyState, Skeleton } from '@/ui/Card'
import { DataTable } from '@/ui/DataTable'
import { ConfirmDialog } from '@/ui/Dialog'
import { PageHeader } from '@/ui/PageHeader'
import { Tooltip } from '@/ui/Controls'
import { useBranding } from '@/core/settings/usePublicSettings'
import { categoryShareItem, useShare } from '@/modules/shared/share'
import { useSeller } from '../seller'
import { CategoryDialog } from '../components/CategoryDialog'
import { useVendorCategories } from '../components/categoryOptions'

export default function VendorCategoriesPage() {
  const seller = useSeller()
  const qc = useQueryClient()
  const { siteName } = useBranding()
  const { share, dialog: shareDialog } = useShare()
  const { data = [], isLoading } = useVendorCategories()
  const [dialog, setDialog] = useState(null) // { category?, parent? }
  const [deleting, setDeleting] = useState(null)

  const mine = data.filter((c) => c.mine)
  const byId = useMemo(() => new Map(data.map((c) => [c._id, c])), [data])
  const tree = useMemo(() => buildTree(data.filter((c) => c.status === 'active')), [data])

  const remove = useMutation({
    mutationFn: (id) => seller.api.deleteCategory(id),
    onSuccess: () => (qc.invalidateQueries({ queryKey: seller.keys.categories }), toast.success('Category removed')),
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <>
      <PageHeader
        title="Categories"
        description={
          seller.isStore
            ? 'Every product belongs to a category. Use the shared catalogue or add a new one; it goes live straight away.'
            : 'Every product belongs to a category. Use the shared catalogue or propose new categories.'
        }
        actions={
          <Button onClick={() => setDialog({})}>
            <FolderPlus /> {seller.isStore ? 'Add category' : 'Propose category'}
          </Button>
        }
      />

      <Card className="mb-6">
        <CardHeader title="Top categories" description="The main departments of the store. Everything else sits under one of these." />
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : tree.length ? (
          <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
            {tree.map((node) => (
              <li key={node._id} className="group flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-3 text-center">
                <Thumb src={node.image?.url} className="size-14 rounded-md" />
                <span className="line-clamp-2 text-sm font-semibold text-slate-900">{node.name}</span>
                <span className="text-xs text-slate-500">
                  {node.children?.length ? `${node.children.length} sub-categor${node.children.length === 1 ? 'y' : 'ies'}` : 'No sub-categories'}
                </span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ parent: node._id })}>
                    <Plus /> Sub-category
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Share ${node.name}`} title="Share category" onClick={() => share(categoryShareItem(node, siteName))}>
                    <Share2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FolderTree} title="No top categories yet" description="Propose the first category for your products." />
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title={seller.isStore ? 'Added by the store' : 'Your proposals'}
            description={
              seller.isStore
                ? 'Categories created from the store. Edit or reorder them under Admin → Categories.'
                : 'Pending categories can be used for your products right away; they show on the store once approved.'
            }
          />
          <DataTable
            loading={isLoading}
            rows={mine}
            empty={
              seller.isStore
                ? { title: 'None added yet', description: 'Add a category when nothing in the catalogue fits your product.' }
                : { title: 'No proposals yet', description: 'Propose a category when nothing in the catalogue fits your product.' }
            }
            columns={[
              {
                key: 'name',
                header: 'Category',
                cell: (c) => (
                  <div className="flex items-center gap-3">
                    <Thumb src={c.image?.url} className="size-9 shrink-0 rounded-md border border-slate-200" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">{c.name}</p>
                      <p className="truncate text-xs text-slate-500">{c.parent ? `in ${byId.get(String(c.parent))?.name ?? '…'}` : 'Top level'}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (c) => (
                  <Tooltip content={c.status === 'rejected' && c.review?.note}>
                    <span>
                      <StatusBadge status={c.status} />
                    </span>
                  </Tooltip>
                ),
              },
              {
                key: 'actions',
                header: '',
                className: 'w-px whitespace-nowrap text-right',
                cell: (c) =>
                  c.status !== 'active' && (
                    <div className="flex justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setDialog({ category: c })}>
                        <Pencil />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={() => setDeleting(c)}>
                        <Trash2 />
                      </Button>
                    </div>
                  ),
              },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Other categories" description="Live sub-categories shared by all sellers, under each top category" />
          {isLoading ? (
            <div className="p-5">
              <Skeleton className="h-48" />
            </div>
          ) : tree.some((n) => n.children?.length) ? (
            <div className="space-y-3 p-2">
              {tree
                .filter((top) => top.children?.length)
                .map((top) => (
                  <section key={top._id}>
                    <h3 className="px-2 pt-1 text-xs font-bold tracking-wide text-slate-500 uppercase">{top.name}</h3>
                    <ul>
                      {top.children.map((node) => (
                        <TreeNode
                          key={node._id}
                          node={node}
                          depth={0}
                          level={1}
                          onAddChild={(parent) => setDialog({ parent: parent._id })}
                          onShare={(c) => share(categoryShareItem(c, siteName))}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          ) : (
            <EmptyState icon={FolderTree} title="No sub-categories yet" description="Add one under a top category." />
          )}
        </Card>
      </div>

      <CategoryDialog
        key={dialog?.category?._id ?? dialog?.parent ?? 'new'}
        open={Boolean(dialog)}
        onOpenChange={(o) => !o && setDialog(null)}
        category={dialog?.category}
        defaultParent={dialog?.parent}
      />
      {shareDialog}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title={`Delete "${deleting?.name}"?`}
        description="Only categories without products can be deleted."
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync(deleting._id)}
      />
    </>
  )
}

/** `depth` indents; `level` is the real tree level (0 = top), which limits where sub-categories can be added. */
function TreeNode({ node, onAddChild, onShare, depth = 0, level = depth }) {
  const [open, setOpen] = useState(false)
  const hasChildren = node.children?.length > 0
  return (
    <li>
      <div className="group flex items-center gap-1 rounded-md pr-2 hover:bg-slate-50" style={{ paddingLeft: depth * 20 }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!hasChildren}
          aria-expanded={hasChildren ? open : undefined}
          aria-label={hasChildren ? `${open ? 'Collapse' : 'Expand'} ${node.name}` : undefined}
          className="grid size-8 place-items-center text-slate-400 disabled:opacity-0"
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>
        <span className="flex-1 py-2 text-sm text-slate-800">{node.name}</span>
        {onShare && (
          <button type="button" onClick={() => onShare(node)} className="mr-2 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 focus:opacity-100">
            Share
          </button>
        )}
        {level < 2 && (
          <button
            type="button"
            onClick={() => onAddChild(node)}
            className="text-xs font-medium text-primary opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            + Sub-category
          </button>
        )}
      </div>
      {open && hasChildren && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c._id} node={c} depth={depth + 1} level={level + 1} onAddChild={onAddChild} onShare={onShare} />
          ))}
        </ul>
      )}
    </li>
  )
}
