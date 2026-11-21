import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Pencil, Plus, Trash2, Truck, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { deliveryFee } from '@/core/lib/delivery'
import { formatINR } from '@/core/lib/format'
import { publicSettingsKey } from '@/core/settings/usePublicSettings'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@/ui/Card'
import { ConfirmDialog } from '@/ui/Dialog'
import { Field } from '@/ui/Field'
import { PriceInput } from '@/ui/inputs'
import { PageHeader } from '@/ui/PageHeader'
import { useAdminAccess } from '../access'
import { adminApi, adminKeys } from '../api'

const MAX_SLABS = 20
const NEW = 'new'
const money = (paise) => formatINR(paise)
const feeText = (paise) => (paise === 0 ? 'Free' : formatINR(paise))

/**
 * Delivery fee by order value: slabs of "from amount – to amount → flat fee". The first slab starts at ₹0 and
 * each next one starts at the previous slab's "to", so slabs never overlap or leave gaps. Each slab is saved
 * on its own (the whole list goes to the server, which checks the same rules).
 */
export default function DeliveryChargesPage() {
  const { data, isLoading } = useQuery({ queryKey: adminKeys.settings, queryFn: adminApi.settings })
  if (isLoading || !data) return <Skeleton className="h-96" />
  return <Slabs slabs={data.shipping.deliverySlabs ?? []} />
}

/** What's wrong with a slab being saved at position `index`, or null. */
function problem(draft, index, slabs) {
  const start = index === 0 ? 0 : slabs[index - 1].to
  if (draft.from == null) return 'Enter the from amount'
  if (draft.from !== start) return index === 0 ? 'The first slab must start from ₹0' : `Must start from ${money(start)}, where slab ${index} ends`
  if (draft.to == null) return 'Enter the to amount'
  if (draft.to <= draft.from) return `To amount must be more than ${money(draft.from)}`
  if (draft.fee == null) return 'Enter the delivery fee (₹0 for free delivery)'
  const next = slabs[index + 1]
  if (next && draft.to >= next.to) {
    return `This would cover slab ${index + 2} too (it ends at ${money(next.to)}). Lower the to amount, or delete slab ${index + 2} first.`
  }
  return null
}

function Slabs({ slabs }) {
  const qc = useQueryClient()
  const canEdit = useAdminAccess().can('settings', 'manage')
  const [editing, setEditing] = useState(null) // slab index, NEW, or null
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState(null)
  const [probe, setProbe] = useState(250_000)

  const save = useMutation({
    mutationFn: (next) => adminApi.updateSettings('shipping', { deliverySlabs: next }),
    onSuccess: (data) => {
      qc.setQueryData(adminKeys.settings, data)
      qc.invalidateQueries({ queryKey: publicSettingsKey })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const startEdit = (index) => {
    setEditing(index)
    setDraft(index === NEW ? { from: slabs.at(-1)?.to ?? 0, to: undefined, fee: undefined } : { ...slabs[index] })
    setError(null)
  }
  const cancel = () => {
    setEditing(null)
    setDraft(null)
    setError(null)
  }

  const saveSlab = async () => {
    const index = editing === NEW ? slabs.length : editing
    const issue = problem(draft, index, slabs)
    if (issue) return setError(issue)
    const next = [...slabs]
    next[index] = { from: draft.from, to: draft.to, fee: draft.fee }
    // Keep the chain joined: the next slab now starts where this one ends.
    const shifted = next[index + 1] && next[index + 1].from !== draft.to
    if (shifted) next[index + 1] = { ...next[index + 1], from: draft.to }
    try {
      await save.mutateAsync(next)
    } catch {
      return // the mutation's onError shows the server's reason
    }
    toast.success(shifted ? `Slab saved. Slab ${index + 2} now starts from ${money(draft.to)}.` : 'Slab saved')
    cancel()
  }

  // The slab after a deleted one takes over its range, so there's never a gap.
  const remove = async (index) => {
    const next = slabs.filter((_, i) => i !== index)
    if (next[index]) next[index] = { ...next[index], from: slabs[index].from }
    await save.mutateAsync(next)
    toast.success('Slab deleted')
  }

  const rows = editing === NEW ? [...slabs, null] : slabs
  const last = slabs.at(-1)
  const probeFee = deliveryFee(probe ?? 0, slabs)

  return (
    <>
      <PageHeader
        title="Delivery charges"
        description="Set a flat delivery fee for each range of order value. The fee is charged once per order, on the items total after any coupon."
      />

      <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader
            title="Slabs"
            description="The first slab starts from ₹0, and each next slab starts from the previous slab's to amount."
            action={
              canEdit &&
              slabs.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => startEdit(NEW)} disabled={editing !== null || slabs.length >= MAX_SLABS}>
                  <Plus /> Add slab
                </Button>
              )
            }
          />
          <CardBody className="flex flex-col gap-4">
            {rows.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="Delivery is free on every order"
                description="Add a slab to start charging for delivery, e.g. ₹0 to ₹2,000 → ₹200."
                action={
                  canEdit && (
                    <Button size="sm" onClick={() => startEdit(NEW)}>
                      <Plus /> Add slab
                    </Button>
                  )
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                      <th className="w-10 py-2 pr-2">#</th>
                      <th className="py-2 pr-3">From amount</th>
                      <th className="py-2 pr-3">To amount</th>
                      <th className="py-2 pr-3">Delivery fee</th>
                      <th className="py-2 text-right">{canEdit && 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((slab, i) => {
                      const isEditing = editing === i || (slab === null && editing === NEW)
                      return isEditing ? (
                        <tr key={i} className="border-b border-slate-100 bg-primary-soft/40 align-top">
                          <td className="py-3 pr-2 font-semibold text-slate-500">{i + 1}</td>
                          <td className="py-2 pr-3">
                            <PriceInput aria-label="From amount" value={draft.from} onChange={(from) => setDraft({ ...draft, from })} />
                          </td>
                          <td className="py-2 pr-3">
                            <PriceInput aria-label="To amount" value={draft.to} onChange={(to) => setDraft({ ...draft, to })} autoFocus />
                          </td>
                          <td className="py-2 pr-3">
                            <PriceInput aria-label="Delivery fee" value={draft.fee} onChange={(fee) => setDraft({ ...draft, fee })} placeholder="0 = free" />
                          </td>
                          <td className="py-2">
                            <div className="flex justify-end gap-1.5">
                              <Button size="sm" loading={save.isPending} onClick={saveSlab}>
                                <Check /> Save
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label="Cancel" onClick={cancel} disabled={save.isPending}>
                                <X />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-3 pr-2 font-semibold text-slate-500">{i + 1}</td>
                          <td className="py-3 pr-3 tabular-nums">{money(slab.from)}</td>
                          <td className="py-3 pr-3 tabular-nums">{money(slab.to)}</td>
                          <td className="py-3 pr-3 font-semibold text-slate-900 tabular-nums">{feeText(slab.fee)}</td>
                          <td className="py-2">
                            {canEdit && (
                              <div className="flex justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => startEdit(i)} disabled={editing !== null}>
                                  <Pencil /> Edit
                                </Button>
                                <ConfirmDialog
                                  title={`Delete slab ${i + 1}?`}
                                  description={
                                    slabs[i + 1]
                                      ? `Slab ${i + 2} will start from ${money(slab.from)} instead, so orders in this range pay ${feeText(slabs[i + 1].fee)}.`
                                      : slabs.length === 1
                                        ? 'With no slabs left, delivery becomes free on every order.'
                                        : `Orders above ${money(slabs[i - 1].to)} will pay slab ${i}'s fee (${feeText(slabs[i - 1].fee)}).`
                                  }
                                  confirmLabel="Delete slab"
                                  onConfirm={() => remove(i)}
                                  trigger={
                                    <Button size="icon-sm" variant="ghost" aria-label={`Delete slab ${i + 1}`} disabled={editing !== null}>
                                      <Trash2 />
                                    </Button>
                                  }
                                />
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            {last && (
              <p className="text-sm text-slate-600">
                Orders of {money(last.to)} and above pay the last slab&apos;s fee: <strong className="text-slate-900">{feeText(last.fee)}</strong>. An
                order exactly on a slab&apos;s to amount falls in the next slab.
              </p>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Try an order value" />
            <CardBody className="flex flex-col gap-3">
              <Field label="Items total after coupon">{(p) => <PriceInput {...p} value={probe} onChange={setProbe} />}</Field>
              <p className="text-sm text-slate-600">
                Delivery fee: <strong className="text-slate-900">{feeText(probeFee)}</strong>
              </p>
            </CardBody>
          </Card>
          <Alert tone="neutral" title="Good to know">
            Delivery is free when every seller in the order is picked up. Orders already placed keep their fee. Manual orders and order links use
            the fee typed in when they&apos;re created.
          </Alert>
        </div>
      </div>
    </>
  )
}
