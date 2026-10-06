import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { applyFieldErrors, errorMessage } from '@/core/api/errors'
import { sessions, useSession } from '@/core/auth/session'
import { formatPhone } from '@/core/lib/format'
import { optionalEmail, optionalGstin, required } from '@/core/lib/validators'
import { Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { SegmentedControl } from '@/ui/Controls'
import { Field, Input } from '@/ui/Field'
import { userApi } from '../../api'

const schema = z
  .object({
    name: required('Name', 120),
    email: optionalEmail,
    accountType: z.enum(['individual', 'business']),
    businessName: z.string().trim().max(200).optional(),
    gstin: optionalGstin,
  })
  .refine((v) => v.accountType !== 'business' || v.businessName, { path: ['businessName'], message: 'Business name is required' })

export default function ProfilePage() {
  const account = useSession('user', (s) => s.account)
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: account?.name ?? '',
      email: account?.email ?? '',
      accountType: account?.accountType ?? 'individual',
      businessName: account?.business?.name ?? '',
      gstin: account?.business?.gstin ?? '',
    },
  })
  const accountType = useWatch({ control: form.control, name: 'accountType' })

  const save = useMutation({
    mutationFn: (v) =>
      userApi.updateMe({
        name: v.name,
        email: v.email || null,
        accountType: v.accountType,
        ...(v.accountType === 'business' ? { businessName: v.businessName, gstin: v.gstin || null } : {}),
      }),
    onSuccess: (me) => {
      sessions.user.getState().setAccount(me)
      form.reset(form.getValues())
      toast.success('Profile saved')
    },
    onError: (err) => applyFieldErrors(err, form.setError) || toast.error(errorMessage(err)),
  })
  const e = form.formState.errors

  return (
    <>
      <title>Profile</title>
      <h1 className="mb-5 text-2xl font-bold text-slate-900">Profile</h1>
      <Card className="max-w-2xl p-5 sm:p-6">
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-5 sm:grid-cols-2" noValidate>
          <Field label="Mobile number" hint="Used to sign in" className="sm:col-span-2">
            {(p) => <Input {...p} value={account?.phone ? formatPhone(account.phone) : 'Not added (you sign in by email)'} disabled />}
          </Field>
          <Field label="Full name" required error={e.name?.message}>
            {(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}
          </Field>
          <Field label="Email" error={e.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-800">Account type</p>
            <Controller
              name="accountType"
              control={form.control}
              render={({ field }) => (
                <SegmentedControl
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'individual', label: 'Individual' },
                    { value: 'business', label: 'Business' },
                  ]}
                />
              )}
            />
          </div>
          {accountType === 'business' && (
            <>
              <Field label="Business name" required error={e.businessName?.message}>
                {(p) => <Input {...p} {...form.register('businessName')} />}
              </Field>
              <Field label="GSTIN" error={e.gstin?.message}>
                {(p) => <Input {...p} className="font-mono uppercase" maxLength={15} {...form.register('gstin')} />}
              </Field>
            </>
          )}
          <div className="flex justify-end border-t border-slate-100 pt-5 sm:col-span-2">
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
              Save changes
            </Button>
          </div>
        </form>
      </Card>
    </>
  )
}
