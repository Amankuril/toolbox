import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { formatPhone } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card, EmptyState, Skeleton } from '@/ui/Card'
import { ConfirmDialog } from '@/ui/Dialog'
import { storeKeys, userApi } from '../../api'
import { AddressDialog } from '../../components/AddressDialog'

export default function AddressesPage() {
  const account = useSession('user', (s) => s.account)
  const qc = useQueryClient()
  const { data: addresses, isLoading } = useQuery({ queryKey: storeKeys.addresses, queryFn: userApi.addresses })
  const [editing, setEditing] = useState(null) // null | 'new' | address
  const [deleting, setDeleting] = useState(null)

  const onDone = (message) => (list) => {
    qc.setQueryData(storeKeys.addresses, list)
    toast.success(message)
  }
  const remove = useMutation({
    mutationFn: (id) => userApi.removeAddress(id),
    onSuccess: onDone('Address removed'),
    onError: (e) => toast.error(errorMessage(e)),
  })
  const makeDefault = useMutation({
    mutationFn: (id) => userApi.updateAddress(id, { isDefault: true }),
    onSuccess: onDone('Default address updated'),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <>
      <title>Addresses</title>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Addresses</h1>
        {addresses?.length > 0 && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add address
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !addresses?.length ? (
        <Card>
          <EmptyState
            icon={MapPin}
            title="No saved addresses"
            description="Save delivery addresses for a faster checkout."
            action={<Button onClick={() => setEditing('new')}>Add address</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <Card key={a._id} className="flex flex-col p-5">
              <p className="flex items-center gap-2 font-semibold text-slate-900">
                {a.name} <Badge>{a.label}</Badge> {a.isDefault && <Badge tone="primary">Default</Badge>}
              </p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                {[a.line1, a.line2, a.landmark].filter(Boolean).join(', ')}
                <br />
                {a.city}, {a.state} {a.pincode}
                <br />
                {formatPhone(a.phone)}
              </p>
              <div className="mt-4 flex flex-wrap gap-1 border-t border-slate-100 pt-3">
                <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                  <Pencil /> Edit
                </Button>
                {!a.isDefault && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={makeDefault.isPending && makeDefault.variables === a._id}
                    onClick={() => makeDefault.mutate(a._id)}
                  >
                    <Star /> Set default
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setDeleting(a)}>
                  <Trash2 /> Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <AddressDialog
        open={Boolean(editing)}
        onOpenChange={(o) => !o && setEditing(null)}
        address={editing === 'new' ? null : editing}
        defaults={{ name: account?.name, phone: account?.phone }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(null)}
        title="Remove this address?"
        description="Past orders keep their delivery address."
        confirmLabel="Remove"
        onConfirm={() => remove.mutateAsync(deleting._id)}
      />
    </>
  )
}
