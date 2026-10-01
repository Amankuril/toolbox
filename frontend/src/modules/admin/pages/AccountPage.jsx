import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { passwordRule } from '@/core/lib/validators'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'
import { Field, Input } from '@/ui/Field'
import { DescriptionList, PageHeader } from '@/ui/PageHeader'
import { adminApi } from '../api'

const schema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordRule, confirm: z.string() })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

export default function AccountPage() {
  const me = useSession('admin', (s) => s.account)
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } })
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }) => adminApi.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      form.reset()
      toast.success('Password changed. Other devices have been signed out.')
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })
  const e = form.formState.errors

  return (
    <>
      <PageHeader title="Your account" />
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                ['Name', me?.name],
                ['Email', me?.email],
                ['Role', me?.adminRole === 'super_admin' ? 'Super admin' : 'Admin'],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" description="You'll stay signed in here; all other sessions end." />
          <CardBody>
            <form onSubmit={form.handleSubmit((v) => change.mutate(v))} className="flex flex-col gap-4" noValidate>
              <Field label="Current password" error={e.currentPassword?.message}>
                {(p) => <Input {...p} type="password" autoComplete="current-password" {...form.register('currentPassword')} />}
              </Field>
              <Field label="New password" error={e.newPassword?.message} hint="At least 10 characters with a letter and a number">
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('newPassword')} />}
              </Field>
              <Field label="Confirm new password" error={e.confirm?.message}>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...form.register('confirm')} />}
              </Field>
              <Button type="submit" loading={change.isPending} className="self-start">
                Update password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
