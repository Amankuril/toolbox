import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { parseApiError } from '@/core/api/errors'
import { Button } from '@/ui/Button'
import { Alert } from '@/ui/Card'
import { Combobox } from '@/ui/Combobox'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Textarea } from '@/ui/Field'
import { ImageUploader } from '@/ui/ImageUploader'
import { useSeller } from '../seller'
import { useCategoryOptions } from './categoryOptions'

/**
 * Propose a new category (or edit a pending/rejected one).
 * New categories need admin approval before they appear on the storefront, but can be used immediately.
 */
export function CategoryDialog({ open, onOpenChange, category, defaultParent, onSaved }) {
  const seller = useSeller()
  const qc = useQueryClient()
  const isEdit = Boolean(category)
  const parents = useCategoryOptions({ maxLevel: 1, excludeId: category?._id })
  const [v, setV] = useState(null)
  const values = v ?? {
    name: category?.name ?? '',
    parent: category?.parent ?? defaultParent ?? '',
    description: category?.description ?? '',
    image: category?.image ? [category.image] : [],
  }
  const set = (patch) => setV({ ...values, ...patch })

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: values.name.trim(),
        parent: values.parent || null,
        description: values.description,
        image: values.image[0] ? { media: values.image[0].media } : null,
      }
      return isEdit ? seller.api.updateCategory(category._id, body) : seller.api.createCategory(body)
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: seller.keys.categories })
      toast.success(
        saved.status === 'active'
          ? 'Category added'
          : isEdit
            ? 'Category updated and resubmitted'
            : 'Category proposed — you can use it now; it goes live once approved',
      )
      setV(null)
      onOpenChange(false)
      onSaved?.(saved)
    },
    // Errors render inline below (field errors next to fields, anything else in the alert).
  })
  const apiError = save.error && parseApiError(save.error)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o || setV(null), onOpenChange(o))}
      title={isEdit ? 'Edit category' : 'Propose a category'}
      description={isEdit ? undefined : "Can't find the right category? Suggest one. Our team reviews it before it appears in the store."}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!values.name.trim()} onClick={() => save.mutate()}>
            {isEdit ? 'Save & resubmit' : 'Propose category'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required error={apiError?.fields?.name}>
          {(p) => <Input {...p} autoFocus value={values.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Chainsaws" />}
        </Field>
        <Field label="Parent category" hint="Leave empty to suggest a new top-level category" error={apiError?.fields?.parent}>
          {(p) => (
            <div className="flex gap-2">
              <div className="flex-1">
                <Combobox
                  {...p}
                  options={parents}
                  value={values.parent}
                  onChange={(parent) => set({ parent })}
                  placeholder="Top level"
                  searchPlaceholder="Search categories"
                />
              </div>
              {values.parent && (
                <Button variant="ghost" onClick={() => set({ parent: '' })}>
                  Clear
                </Button>
              )}
            </div>
          )}
        </Field>
        <Field label="Description">
          {(p) => <Textarea {...p} rows={3} value={values.description} onChange={(e) => set({ description: e.target.value })} />}
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-800">Image (optional)</p>
          <ImageUploader audience={seller.audience} uploadPath={seller.uploadPath} folder="categories" max={1} value={values.image} onChange={(image) => set({ image })} compact />
        </div>
        {apiError && !Object.keys(apiError.fields).length && <Alert tone="danger">{apiError.message}</Alert>}
      </div>
    </Dialog>
  )
}
