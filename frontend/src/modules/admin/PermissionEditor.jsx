import { SegmentedControl } from '@/ui/Controls'
import { SECTIONS } from './access'
import { PRESETS } from './permissionPresets'

const LEVELS = [
  { value: 'none', label: 'None' },
  { value: 'view', label: 'View' },
  { value: 'manage', label: 'Manage' },
]

export function PermissionEditor({ value, onChange }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-slate-600">Start from:</span>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange({ ...p.value })}
            className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-800 hover:border-slate-500"
          >
            {p.label}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {SECTIONS.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">{s.label}</span>
              <span className="block text-xs text-slate-600">{s.help}</span>
            </span>
            <SegmentedControl size="sm" value={value[s.key] ?? 'none'} onChange={(level) => onChange({ ...value, [s.key]: level })} options={LEVELS} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">View lets them open a section without changing anything. Only super admins can manage admins.</p>
    </div>
  )
}
