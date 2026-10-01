import { Plus, Trash2 } from 'lucide-react'
import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import { formatINR, formatNumber } from '@/core/lib/format'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'
import { Switch } from '@/ui/Controls'
import { Checkbox, Field } from '@/ui/Field'
import { NumberInput, PriceInput } from '@/ui/inputs'
import { MAX_TIERS } from './bulkRules'

function suggestNextQty(tiers, moq) {
  const last = tiers.at(-1)?.minQty
  if (!last) return Math.max(10, (moq ?? 1) * 10)
  return last < 10 ? last + 10 : last * 2
}

export function BulkPricingCard({ control, register, errors, unit = 'piece' }) {
  const tiers = useFieldArray({ control, name: 'bulkPricing.tiers' })
  const values = useWatch({ control, name: 'bulkPricing.tiers' }) ?? []
  const basePrice = useWatch({ control, name: 'pricing.price' })
  const moq = useWatch({ control, name: 'inventory.moq' }) ?? 1
  const quotesEnabled = useWatch({ control, name: 'quotes.enabled' })
  const e = errors.bulkPricing?.tiers
  const topTier = values.length ? Math.max(...values.map((t) => t?.minQty ?? 0)) : 0
  const defaultQuoteFrom = topTier || Math.max(10, moq * 10)

  return (
    <Card>
      <CardHeader
        title="Bulk pricing"
        description="Lower the price per unit for larger quantities. The right price applies automatically in the buyer's cart."
      />
      <CardBody className="flex flex-col gap-5">
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-[1fr_1fr_64px_40px] gap-3 bg-slate-50 px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <span>Buy at least</span>
            <span>Price per {unit}</span>
            <span className="text-right">Saving</span>
            <span />
          </div>
          <div className="grid grid-cols-[1fr_1fr_64px_40px] items-center gap-3 border-t border-slate-100 px-3 py-2.5 text-sm text-slate-600">
            <span className="tabular">
              {formatNumber(moq)} {unit}
              {moq === 1 ? '' : 's'}
            </span>
            <span className="tabular">{basePrice ? formatINR(basePrice) : '—'}</span>
            <span className="text-right text-xs text-slate-400">Listed</span>
            <span />
          </div>
          {tiers.fields.map((f, i) => {
            const price = values[i]?.price
            const save = basePrice && price && price < basePrice ? Math.round(((basePrice - price) / basePrice) * 100) : 0
            return (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_64px_40px] items-start gap-3 border-t border-slate-100 px-3 py-2.5">
                <div>
                  <Controller
                    name={`bulkPricing.tiers.${i}.minQty`}
                    control={control}
                    render={({ field }) => (
                      <NumberInput
                        aria-label={`Tier ${i + 1} minimum quantity`}
                        min={2}
                        value={field.value}
                        onChange={field.onChange}
                        aria-invalid={Boolean(e?.[i]?.minQty) || undefined}
                      />
                    )}
                  />
                  {e?.[i]?.minQty && <p className="mt-1 text-xs font-medium text-red-600">{e[i].minQty.message}</p>}
                </div>
                <div>
                  <Controller
                    name={`bulkPricing.tiers.${i}.price`}
                    control={control}
                    render={({ field }) => (
                      <PriceInput
                        aria-label={`Tier ${i + 1} price per ${unit}`}
                        value={field.value}
                        onChange={field.onChange}
                        aria-invalid={Boolean(e?.[i]?.price) || undefined}
                      />
                    )}
                  />
                  {e?.[i]?.price && <p className="mt-1 text-xs font-medium text-red-600">{e[i].price.message}</p>}
                </div>
                <span className="tabular pt-2.5 text-right text-sm font-semibold text-accent-ink">{save ? `${save}%` : ''}</span>
                <Button variant="ghost" size="icon" aria-label={`Remove tier ${i + 1}`} onClick={() => tiers.remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={tiers.fields.length >= MAX_TIERS}
            onClick={() => tiers.append({ minQty: suggestNextQty(values, moq), price: undefined })}
          >
            <Plus /> Add tier
          </Button>
          <span className="text-xs text-slate-500">
            {tiers.fields.length}/{MAX_TIERS} tiers
          </span>
        </div>
        {errors.bulkPricing?.tiers?.root?.message && <p className="text-xs font-medium text-red-600">{errors.bulkPricing.tiers.root.message}</p>}

        {tiers.fields.length > 0 && (
          <Checkbox
            label="Only for business buyers"
            description="Individual buyers see the listed price; buyers with a business account get these tiers."
            {...register('bulkPricing.businessOnly')}
          />
        )}

        <div className="border-t border-slate-100 pt-5">
          <Controller
            name="quotes.enabled"
            control={control}
            render={({ field }) => (
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                label="Accept quote requests"
                description="Buyers can ask for a custom price on large quantities. You reply with a price and how long it's valid."
              />
            )}
          />
          {quotesEnabled && (
            <Field
              label="Quotes from"
              hint={`Leave empty to use ${formatNumber(defaultQuoteFrom)} ${unit}s (${topTier ? 'your top tier' : '10× the min. order'}).`}
              error={errors.quotes?.minQty?.message}
              className="mt-4 max-w-56"
            >
              {(p) => (
                <Controller
                  name="quotes.minQty"
                  control={control}
                  render={({ field }) => <NumberInput {...p} min={1} value={field.value} onChange={field.onChange} placeholder={String(defaultQuoteFrom)} />}
                />
              )}
            </Field>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
