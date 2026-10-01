import { DropdownMenu, Switch as RSwitch, Tabs as RTabs, Tooltip as RTooltip } from 'radix-ui'
import { cn } from '@/core/lib/cn'

export function Switch({ checked, onCheckedChange, disabled, label, description, id }) {
  return (
    <label className={cn('flex items-start justify-between gap-4', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-slate-900">{label}</span>}
          {description && <span className="mt-0.5 block text-sm text-slate-500">{description}</span>}
        </span>
      )}
      <RSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-300 transition-colors data-[state=checked]:bg-primary"
      >
        <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
      </RSwitch.Root>
    </label>
  )
}

/** Pill-style single choice (e.g. product type, account type). */
export function SegmentedControl({ value, onChange, options, className, size = 'md' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Underlined status tabs for list pages. `counts` shows numbers next to labels. */
export function FilterTabs({ value, onChange, options, counts }) {
  return (
    <div className="scrollbar-none -mb-px flex gap-1 overflow-x-auto border-b border-slate-200">
      {options.map((o) => (
        <button
          key={o.value || 'all'}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            (value ?? '') === (o.value ?? '') ? 'border-primary text-primary' : 'border-transparent text-slate-600 hover:text-slate-900',
          )}
        >
          {o.label}
          {counts?.[o.value] > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{counts[o.value]}</span>}
        </button>
      ))}
    </div>
  )
}

export function Tabs({ value, onValueChange, defaultValue, tabs, className }) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue ?? tabs[0]?.value} className={className}>
      <RTabs.List className="scrollbar-none flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-900 data-[state=active]:border-primary data-[state=active]:text-primary [&_svg]:size-4"
          >
            {t.icon && <t.icon />}
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="pt-5 focus:outline-none">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  )
}

/** Drops falsy items plus leading, trailing and doubled separators. */
function cleanItems(items) {
  const out = []
  for (const item of items) {
    if (!item) continue
    if (item === 'separator' && (!out.length || out.at(-1) === 'separator')) continue
    out.push(item)
  }
  while (out.at(-1) === 'separator') out.pop()
  return out
}

export function Menu({ trigger, items, align = 'end' }) {
  return (
    // Non-modal: actions often open a dialog, and a modal menu would leave the page inert behind it.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className="z-50 min-w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {cleanItems(items).map((item, i) =>
            item === 'separator' ? (
              <DropdownMenu.Separator key={i} className="my-1 h-px bg-slate-100" />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                onSelect={item.onSelect}
                disabled={item.disabled}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100 [&_svg]:size-4 [&_svg]:text-slate-500',
                  item.danger && 'text-red-600 data-[highlighted]:bg-red-50 [&_svg]:text-red-500',
                )}
              >
                {item.icon && <item.icon />}
                {item.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Tooltip({ content, children, side = 'top' }) {
  if (!content) return children
  return (
    <RTooltip.Provider delayDuration={200}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  )
}
