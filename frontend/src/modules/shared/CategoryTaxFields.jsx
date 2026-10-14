import { GST_RATES } from '@/core/lib/constants'
import { Field, Input, Select } from '@/ui/Field'

/**
 * A category's default HSN code and GST rate. Products filed in it (and in sub-categories that leave
 * these empty) use them unless the product sets its own. Value: `{ hsnCode: string, gstRate: string }`,
 * '' meaning "not set here".
 */
export function CategoryTaxFields({ value, onChange, errors = {}, className }) {
  const v = value ?? { hsnCode: '', gstRate: '' }
  return (
    <fieldset className={className}>
      <legend className="mb-1 text-sm font-semibold text-slate-900">GST defaults for products</legend>
      <p className="mb-3 text-xs text-slate-500">Products in this category use these unless they set their own. Leave empty to use the parent category’s.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="HSN/SAC code" error={errors.hsnCode} hint="4, 6 or 8 digits">
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              maxLength={8}
              value={v.hsnCode}
              onChange={(e) => onChange({ ...v, hsnCode: e.target.value.replace(/\D/g, '') })}
              placeholder="e.g. 8467"
            />
          )}
        </Field>
        <Field label="GST rate" error={errors.gstRate}>
          {(p) => (
            <Select {...p} value={v.gstRate} onChange={(e) => onChange({ ...v, gstRate: e.target.value })}>
              <option value="">Not set (use parent’s)</option>
              {GST_RATES.map((r) => (
                <option key={r} value={String(r)}>
                  {r}%
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </fieldset>
  )
}
