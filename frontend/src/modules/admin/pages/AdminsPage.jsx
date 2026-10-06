import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Navigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { formatDateTime } from '@/core/lib/format'
import { email, passwordRule } from '@/core/lib/validators'
import { Badge, StatusBadge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { DataTable } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Select } from '@/ui/Field'
import { PageHeader } from '@/ui/PageHeader'
import { adminApi, adminKeys } from '../api'
import { PermissionEditor } from '../PermissionEditor'
import { emptyPermissions, summarize } from '../permissionPresets'

export default function AdminsPage() {
  const me = useSession('admin', (s) => s.account)
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const { data, isLoading } = useQuery({ queryKey: adminKeys.admins, queryFn: adminApi.admins, enabled: me?.adminRole === 'super_admin' })
  const update = useMutation({
    mutationFn: ({ id, ...body }) => adminApi.updateAdmin(id, body),
    onSuccess: () => (qc.invalidateQueries({ queryKey: adminKeys.admins }), toast.success('Admin updated')),
    onError: (err) => toast.error(errorMessage(err)),
  })

  if (me && me.adminRole !== 'super_admin') return <Navigate to="/admin" replace />

  return (
    <>
      <PageHeader
        title="Admins"
        description="People who can sign in to this panel."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add admin
          </Button>
        }
      />
      <Card>
        <DataTable
          loading={isLoading}
          rows={data}
          columns={[
            {
              key: 'name',
              header: 'Admin',
              cell: (a) => (
                <div>
                  <p className="font-medium text-slate-900">
                    {a.name} {a._id === me?._id && <span className="text-xs font-normal text-slate-500">(you)</span>}
                  </p>
                  <p className="text-xs text-slate-500">{a.email}</p>
                </div>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              cell: (a) =>
                a._id === me?._id ? (
                  <Badge tone="primary">
                    <ShieldCheck className="size-3" /> Super admin
                  </Badge>
                ) : (
                  <Select value={a.adminRole} onChange={(e) => update.mutate({ id: a._id, role: e.target.value })} className="h-8 w-40 text-xs">
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super admin</option>
                  </Select>
                ),
            },
            {
              key: 'access',
              header: 'Access',
              cell: (a) => <p className="max-w-xs text-xs leading-relaxed text-slate-600">{summarize(a)}</p>,
            },
            { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status === 'disabled' ? 'inactive' : 'active'} /> },
            { key: 'last', header: 'Last sign-in', cell: (a) => formatDateTime(a.lastLoginAt) },
            {
              key: 'actions',
              header: '',
              className: 'text-right',
              cell: (a) =>
                a._id !== me?._id && (
                  <div className="flex justify-end gap-2">
                    {a.adminRole !== 'super_admin' && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
                        Permissions
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={a.status === 'active' ? 'danger-outline' : 'outline'}
                      onClick={() => update.mutate({ id: a._id, status: a.status === 'active' ? 'disabled' : 'active' })}
                    >
                      {a.status === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      </Card>
      <CreateAdminDialog open={creating} onOpenChange={setCreating} />
      {editing && <PermissionsDialog admin={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

const schema = z.object({ name: z.string().trim().min(1, 'Name is required').max(120), email, password: passwordRule, role: z.enum(['admin', 'super_admin']) })

function CreateAdminDialog({ open, onOpenChange }) {
  const qc = useQueryClient()
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', password: '', role: 'admin' } })
  const [permissions, setPermissions] = useState(emptyPermissions)
  const role = useWatch({ control: form.control, name: 'role' })
  const create = useMutation({
    mutationFn: (v) => adminApi.createAdmin(v.role === 'admin' ? { ...v, permissions } : v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.admins })
      toast.success('Admin added. Share the password with them securely.')
      form.reset()
      onOpenChange(false)
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })
  const e = form.formState.errors
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add admin"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>
            Add admin
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(ev) => ev.preventDefault()}>
        <Field label="Name" required error={e.name?.message}>
          {(p) => <Input {...p} {...form.register('name')} />}
        </Field>
        <Field label="Email" required error={e.email?.message}>
          {(p) => <Input {...p} type="email" {...form.register('email')} />}
        </Field>
        <Field label="Temporary password" required error={e.password?.message} hint="At least 10 characters with a letter and a number">
          {(p) => <Input {...p} type="text" autoComplete="new-password" {...form.register('password')} />}
        </Field>
        <Field label="Role">
          {(p) => (
            <Select {...p} {...form.register('role')}>
              <option value="admin">Staff: only the sections you choose below</option>
              <option value="super_admin">Super admin: everything, including admins</option>
            </Select>
          )}
        </Field>
        {role === 'admin' && (
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">What can they see and change?</p>
            <PermissionEditor value={permissions} onChange={setPermissions} />
          </div>
        )}
      </form>
    </Dialog>
  )
}

function PermissionsDialog({ admin, onClose }) {
  const qc = useQueryClient()
  // Admins from before permissions start from "everything", so saving doesn't silently remove access.
  const [value, setValue] = useState(() => ({ ...admin.permissions }))
  const save = useMutation({
    mutationFn: () => adminApi.updateAdmin(admin._id, { permissions: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: adminKeys.admins })
      toast.success(`Permissions updated. ${admin.name} sees the change on their next click.`)
      onClose()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Permissions for ${admin.name}`}
      description={admin.email}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save permissions
          </Button>
        </>
      }
    >
      <PermissionEditor value={value} onChange={setValue} />
    </Dialog>
  )
}
