import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FolderPlus, FolderTree, Pencil, Trash2 } from 'lucide-react'
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
import { useSeller } from '../seller'
import { CategoryDialog } from '../components/CategoryDialog'
import { useVendorCategories } from '../components/categoryOptions'

export default function VendorCategoriesPage() {
  const seller = useSeller()
  const qc = useQueryClient()
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
          <CardHeader title="Catalogue" description="Live categories shared by all sellers" />
          {isLoading ? (
            <div className="p-5">
              <Skeleton className="h-48" />
            </div>
          ) : tree.length ? (
            <ul className="p-2">
              {tree.map((node) => (
                <TreeNode key={node._id} node={node} onAddChild={(parent) => setDialog({ parent: parent._id })} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={FolderTree} title="The catalogue is empty" description="Propose the first category for your products." />
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

function TreeNode({ node, onAddChild, depth = 0 }) {
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
        {depth < 2 && (
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
            <TreeNode key={c._id} node={c} depth={depth + 1} onAddChild={onAddChild} />
          ))}
        </ul>
      )}
    </li>
  )
}
