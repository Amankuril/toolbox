import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import { Button } from '@/ui/Button'
import { Card, CardBody, CardHeader } from '@/ui/Card'
import { Field, Input } from '@/ui/Field'
import { NumberInput, PriceInput, TagInput } from '@/ui/inputs'

export const MAX_OPTIONS = 3
const MAX_VARIANTS = 100
const OPTION_SUGGESTIONS = ['Size', 'Colour', 'Material', 'Capacity', 'Power', 'Pack size']

const comboKey = (options) => options.map((v) => v.toLowerCase()).join('\u0000')

/** Every combination of the option values, in option order. */
function combinations(options) {
  const usable = options.filter((o) => o.name?.trim() && o.values?.length)
  if (!usable.length) return []
  return usable.reduce((acc, o) => acc.flatMap((combo) => o.values.map((v) => [...combo, v])), [[]]).slice(0, MAX_VARIANTS)
}

/**
 * Up to 3 options (Size, Colour…). Each combination becomes a variant with its own
 * price, MRP, SKU, barcode, stock, weight and availability.
 */
export function VariantsCard({ control, register, setValue, errors, tracked }) {
  const options = useFieldArray({ control, name: 'variantOptions' })
  const optionValues = useWatch({ control, name: 'variantOptions' }) ?? []
  const rows = useWatch({ control, name: 'variants' }) ?? []
  const [bulk, setBulk] = useState({})
  const e = errors.variants

  // Rebuild rows when the combinations change, keeping what was typed for combinations that remain.
  const combos = combinations(optionValues)
  const signature = combos.map(comboKey).join('|')
  useEffect(() => {
    const byKey = new Map(rows.map((r) => [comboKey(r.options), r]))
    const next = combos.map(
      (combo) =>
        byKey.get(comboKey(combo)) ?? {
          options: combo,
          price: undefined,
          mrp: undefined,
          sku: '',
          barcode: '',
          stock: 0,
          available: true,
          weightKg: undefined,
        },
    )
    if (next.map((r) => comboKey(r.options)).join('|') !== rows.map((r) => comboKey(r.options)).join('|')) {
      setValue('variants', next, { shouldDirty: true })
    }
    // `signature` captures the combinations; rows/combos are read fresh on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const applyToAll = () => {
    rows.forEach((_, i) => {
      for (const key of ['price', 'mrp', 'stock']) if (bulk[key] !== undefined) setValue(`variants.${i}.${key}`, bulk[key], { shouldDirty: true })
    })
  }

  return (
    <Card>
      <CardHeader
        title="Variants"
        description={`Add variants like size or colour. You can add up to ${MAX_OPTIONS} options; each combination gets its own price and stock.`}
      />
      <CardBody className="flex flex-col gap-5">
        {options.fields.map((f, i) => (
          <div key={f.id} className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[180px_1fr_40px]">
            <Field label="Option name" error={errors.variantOptions?.[i]?.name?.message}>
              {(p) => <Input {...p} list="variant-option-names" placeholder="e.g. Size" {...register(`variantOptions.${i}.name`)} />}
            </Field>
            <Field label="Values" hint="Press Enter after each" error={errors.variantOptions?.[i]?.values?.message}>
              {() => (
                <Controller
                  name={`variantOptions.${i}.values`}
                  control={control}
                  render={({ field }) => <TagInput value={field.value} onChange={field.onChange} max={20} placeholder="e.g. S, M, L" />}
                />
              )}
            </Field>
            <Button variant="ghost" size="icon" aria-label="Remove option" className="sm:mt-6" onClick={() => options.remove(i)}>
              <Trash2 />
            </Button>
          </div>
        ))}
        <datalist id="variant-option-names">
          {OPTION_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {options.fields.length < MAX_OPTIONS && (
          <Button variant="outline" size="sm" className="self-start" onClick={() => options.append({ name: '', values: [] })}>
            <Plus /> {options.fields.length ? 'Add another option' : 'Add options like size or colour'}
          </Button>
        )}

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
              <Field label="Price for all" className="w-36">
                {(p) => <PriceInput {...p} value={bulk.price} onChange={(price) => setBulk({ ...bulk, price })} />}
              </Field>
              <Field label="MRP for all" className="w-36">
                {(p) => <PriceInput {...p} value={bulk.mrp} onChange={(mrp) => setBulk({ ...bulk, mrp })} />}
              </Field>
              {tracked && (
                <Field label="Stock for all" className="w-28">
                  {(p) => <NumberInput {...p} value={bulk.stock} onChange={(stock) => setBulk({ ...bulk, stock })} />}
                </Field>
              )}
              <Button size="sm" variant="outline" onClick={applyToAll}>
                Apply to all
              </Button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Variant</th>
                    <th className="px-2 py-2">Price*</th>
                    <th className="px-2 py-2">MRP*</th>
                    <th className="px-2 py-2">SKU</th>
                    <th className="px-2 py-2">Barcode</th>
                    {tracked && <th className="px-2 py-2">Stock</th>}
                    <th className="px-2 py-2">Weight (kg)</th>
                    <th className="px-2 py-2 text-center">Sell</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, i) => (
                    <tr key={comboKey(row.options)} className={row.available === false ? 'bg-slate-50 text-slate-400' : undefined}>
                      <td className="px-3 py-2 font-medium whitespace-nowrap text-slate-900">
                        {row.options.join(' / ')}
                        {e?.[i]?.options && <p className="text-xs font-normal text-red-600">{e[i].options.message}</p>}
                      </td>
                      <td className="w-32 px-2 py-2">
                        <Controller
                          name={`variants.${i}.price`}
                          control={control}
                          render={({ field }) => (
                            <PriceInput aria-label="Price" aria-invalid={Boolean(e?.[i]?.price) || undefined} value={field.value} onChange={field.onChange} />
                          )}
                        />
                      </td>
                      <td className="w-32 px-2 py-2">
                        <Controller
                          name={`variants.${i}.mrp`}
                          control={control}
                          render={({ field }) => (
                            <PriceInput aria-label="MRP" aria-invalid={Boolean(e?.[i]?.mrp) || undefined} value={field.value} onChange={field.onChange} />
                          )}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input aria-label="SKU" placeholder="Auto" {...register(`variants.${i}.sku`)} />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label="Barcode"
                          inputMode="numeric"
                          aria-invalid={Boolean(e?.[i]?.barcode) || undefined}
                          {...register(`variants.${i}.barcode`)}
                        />
                      </td>
                      {tracked && (
                        <td className="w-24 px-2 py-2">
                          <Controller
                            name={`variants.${i}.stock`}
                            control={control}
                            render={({ field }) => <NumberInput aria-label="Stock" value={field.value} onChange={field.onChange} />}
                          />
                        </td>
                      )}
                      <td className="w-24 px-2 py-2">
                        <Controller
                          name={`variants.${i}.weightKg`}
                          control={control}
                          render={({ field }) => <NumberInput aria-label="Weight" step="0.1" value={field.value} onChange={field.onChange} />}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label="Available to buy"
                          className="size-4 accent-[var(--tb-primary)]"
                          {...register(`variants.${i}.available`)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {typeof e?.message === 'string' && <p className="text-sm text-red-600">{e.message}</p>}
            <p className="text-xs text-slate-500">Untick “Sell” to stop selling a combination without deleting it. Leave SKU empty to generate one.</p>
          </>
        )}
      </CardBody>
    </Card>
  )
}
