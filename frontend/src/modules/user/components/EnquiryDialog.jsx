import { useMutation } from '@tanstack/react-query'
import { BellRing, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { one, publicApi } from '@/core/api/http'
import { errorMessage } from '@/core/api/errors'
import { useSession } from '@/core/auth/session'
import { Button } from '@/ui/Button'
import { Dialog } from '@/ui/Dialog'
import { Field, Input, Textarea } from '@/ui/Field'
import { NumberInput, PhoneInput } from '@/ui/inputs'

/** Out of stock: tell the seller you want it. They see it under Enquiries and can WhatsApp you when it's back. */
export function EnquiryCard({ product, variant, className }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-lg border-2 border-amber-400/60 bg-amber-50 p-3 text-left transition-colors hover:border-amber-500 ${className ?? ''}`}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-500 text-white">
          <BellRing className="size-[18px]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">Out of stock: ask the seller</span>
          <span className="block text-xs text-slate-700">Leave your number and how many you need. The seller contacts you when it's available.</span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Ask about this product" description={variant ? `${product.name} · ${variant.title}` : product.name}>
        {open && <EnquiryForm product={product} variant={variant} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  )
}

function EnquiryForm({ product, variant, onDone }) {
  const account = useSession('user', (s) => s.account)
  const [name, setName] = useState(account?.name ?? '')
  const [phone, setPhone] = useState((account?.phone ?? '').replace(/^\+91/, ''))
  const [quantity, setQuantity] = useState(product.inventory?.moq ?? 1)
  const [message, setMessage] = useState('')
  const send = useMutation({
    mutationFn: () =>
      one(
        publicApi.post(`/public/products/${product._id}/enquiries`, {
          name: name.trim(),
          phone,
          quantity: quantity || 1,
          message: message.trim() || undefined,
          ...(variant ? { variantId: variant._id } : {}),
        }),
      ),
    onError: (err) => toast.error(errorMessage(err)),
  })
  if (send.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="size-10 text-emerald-600" />
        <p className="font-semibold text-slate-900">Request sent</p>
        <p className="text-sm text-slate-600">The seller will contact you on WhatsApp or by phone.</p>
        <Button onClick={onDone}>Done</Button>
      </div>
    )
  }
  const valid = name.trim() && /^[6-9]\d{9}$/.test(phone)
  return (
    <div className="flex flex-col gap-4">
      <Field label="Your name" required>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />}
      </Field>
      <Field label="Mobile number" required>
        {(p) => <PhoneInput {...p} value={phone} onChange={setPhone} />}
      </Field>
      <Field label="Quantity you need">{(p) => <NumberInput {...p} min={1} value={quantity} onChange={setQuantity} />}</Field>
      <Field label="Message" hint="Optional: when you need it, delivery place…">
        {(p) => <Textarea {...p} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />}
      </Field>
      <Button disabled={!valid} loading={send.isPending} onClick={() => send.mutate()}>
        Send request
      </Button>
    </div>
  )
}
