import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, ListChecks, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { cn } from '@/core/lib/cn'
import { formatDateTime, formatNumber } from '@/core/lib/format'
import { Badge } from '@/ui/Badge'
import { Button } from '@/ui/Button'
import { Alert, Card, CardBody, CardHeader, Skeleton } from '@/ui/Card'
import { SegmentedControl } from '@/ui/Controls'
import { DataTable, Pagination } from '@/ui/DataTable'
import { PageHeader } from '@/ui/PageHeader'
import { useVendor, vendorApi, vendorKeys } from '../api'

const MODES = [
  { value: 'create', label: 'Add new products' },
  { value: 'upsert', label: 'Add new & update existing (by SKU)' },
]
const IMPORT_STATUS = {
  validated: ['Checked', 'info'],
  queued: ['Queued', 'warning'],
  processing: ['Importing', 'warning'],
  completed: ['Completed', 'success'],
  cancelled: ['Cancelled', 'neutral'],
  failed: ['Failed', 'danger'],
}
const ITEM_STATUS = {
  invalid: ['Has problems', 'danger'],
  pending: ['Waiting', 'neutral'],
  processing: ['Importing', 'warning'],
  created: ['Added', 'success'],
  updated: ['Updated', 'success'],
  failed: ['Failed', 'danger'],
  skipped: ['Skipped', 'neutral'],
}
const StateBadge = ({ map, status }) => (
  <Badge tone={map[status]?.[1]} dot>
    {map[status]?.[0] ?? status}
  </Badge>
)
const RUNNING = ['queued', 'processing']

export default function ProductImportPage() {
  const vendor = useVendor()
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  if (vendor && vendor.status !== 'approved') return <Navigate to="/vendor/products" replace />

  return (
    <>
      <PageHeader
        back={{ to: '/vendor/products', label: 'Products' }}
        title="Bulk upload products"
        description="Add or update many products at once from a spreadsheet."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {id ? <ImportStatus id={id} onReset={() => setParams({})} /> : <UploadCard onUploaded={(imp) => setParams({ id: imp._id })} />}
        </div>
        <div className="flex flex-col gap-6">
          <HowItWorks />
          <History currentId={id} onOpen={(importId) => setParams({ id: importId })} />
        </div>
      </div>
    </>
  )
}

/* ─────────────── Upload ─────────────── */

function UploadCard({ onUploaded }) {
  const qc = useQueryClient()
  const input = useRef(null)
  const [file, setFile] = useState(null)
  const [mode, setMode] = useState('create')
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)

  const upload = useMutation({
    mutationFn: () => vendorApi.uploadImport(file, mode, (e) => e.total && setProgress(Math.round((e.loaded / e.total) * 100))),
    onSuccess: (imp) => {
      qc.invalidateQueries({ queryKey: ['vendor', 'imports'] })
      qc.setQueryData(vendorKeys.import(imp._id), imp)
      onUploaded(imp)
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setProgress(0),
  })

  const pick = (f) => {
    if (!f) return
    if (!/\.csv$/i.test(f.name)) return toast.error('Choose a .csv file. In Excel use File → Save as → CSV (UTF-8).')
    if (f.size > 5 * 1024 * 1024) return toast.error('The file is larger than 5 MB. Split it into smaller files.')
    setFile(f)
  }

  return (
    <Card>
      <CardHeader title="Upload your file" description="We check every row first. Nothing is added until you confirm." />
      <CardBody className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-800">What should this file do?</p>
          <SegmentedControl value={mode} onChange={setMode} options={MODES} />
          <p className="mt-2 text-xs text-slate-500">
            {mode === 'create'
              ? 'Every row becomes a new product. Rows whose SKU you already use are flagged.'
              : 'Rows with a SKU you already use update that product; the rest are added. Tip: export your products, edit the sheet and upload it here.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            pick(e.dataTransfer.files?.[0])
          }}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragging ? 'border-primary bg-primary-soft' : 'border-slate-200 hover:border-slate-300',
          )}
        >
          <FileSpreadsheet className="size-8 text-slate-400" />
          {file ? (
            <>
              <span className="font-medium text-slate-900">{file.name}</span>
              <span className="text-xs text-slate-500">{formatNumber(Math.ceil(file.size / 1024))} KB · click to choose another</span>
            </>
          ) : (
            <>
              <span className="font-medium text-slate-900">Drop your CSV here or click to choose</span>
              <span className="text-xs text-slate-500">CSV only, up to 5 MB and 5,000 rows</span>
            </>
          )}
        </button>
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />

        <div className="flex flex-wrap items-center justify-end gap-3">
          {upload.isPending && progress > 0 && progress < 100 && <span className="text-sm text-slate-500">Uploading {progress}%</span>}
          {upload.isPending && progress >= 100 && <span className="text-sm text-slate-500">Checking rows…</span>}
          <Button disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
            <Upload /> Upload & check
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

/* ─────────────── Status ─────────────── */

function ImportStatus({ id, onReset }) {
  const qc = useQueryClient()
  const { data: imp, isLoading } = useQuery({
    queryKey: vendorKeys.import(id),
    queryFn: () => vendorApi.import(id),
    refetchInterval: (q) => (RUNNING.includes(q.state.data?.status) ? 2000 : false),
  })
  const refresh = (updated) => {
    qc.setQueryData(vendorKeys.import(id), updated)
    qc.invalidateQueries({ queryKey: ['vendor', 'imports'] })
    qc.invalidateQueries({ queryKey: ['vendor', 'import', id, 'items'] })
  }
  const start = useMutation({ mutationFn: () => vendorApi.startImport(id), onSuccess: refresh, onError: (err) => toast.error(errorMessage(err)) })
  const cancel = useMutation({ mutationFn: () => vendorApi.cancelImport(id), onSuccess: refresh, onError: (err) => toast.error(errorMessage(err)) })

  const finished = ['completed', 'cancelled', 'failed'].includes(imp?.status)
  // New products appear in the list once the import ends.
  useEffect(() => {
    if (finished) qc.invalidateQueries({ queryKey: ['vendor', 'products'] })
  }, [finished, qc])

  if (isLoading || !imp) return <Skeleton className="h-72" />
  const c = imp.counts
  const running = RUNNING.includes(imp.status)

  return (
    <>
      <Card>
        <CardHeader
          title={imp.fileName ?? 'Import'}
          description={`${MODES.find((m) => m.value === imp.mode)?.label} · uploaded ${formatDateTime(imp.createdAt)}`}
          action={<StateBadge map={IMPORT_STATUS} status={imp.status} />}
        />
        <CardBody className="flex flex-col gap-5">
          {imp.fileIssues.map((i, n) => (
            <Alert key={n} tone={c.items ? 'warning' : 'danger'}>
              {i.row ? `Row ${i.row}: ` : ''}
              {i.message}
            </Alert>
          ))}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Rows" value={c.rows} />
            <Stat label="Products" value={c.items} />
            <Stat label="Ready" value={c.valid} tone="success" />
            <Stat label="With problems" value={c.invalid} tone={c.invalid ? 'danger' : undefined} />
          </div>

          {(running || finished) && imp.startedAt && (
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="text-slate-700">
                  {formatNumber(c.created)} added · {formatNumber(c.updated)} updated · {formatNumber(c.failed)} failed
                </span>
                <span className="tabular font-medium">{imp.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cn('h-full rounded-full transition-all', c.failed ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${imp.progress}%` }} />
              </div>
              {running && <p className="mt-2 text-xs text-slate-500">You can leave this page; the import keeps running.</p>}
            </div>
          )}

          {imp.status === 'completed' && (
            <Alert tone={c.failed ? 'warning' : 'success'} icon={CheckCircle2} title="Import finished">
              {formatNumber(c.created + c.updated)} of {formatNumber(c.valid)} products saved.
              {c.failed > 0 && ' Fix the failed rows below and upload them again.'} Products set to publish follow your store’s review rules.
            </Alert>
          )}
          {imp.status === 'failed' && imp.error && <Alert tone="danger">{imp.error}</Alert>}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
            {(c.invalid > 0 || c.failed > 0 || imp.fileIssues.length > 0) && (
              <Button variant="outline" onClick={() => vendorApi.downloadImportIssues(id).catch((err) => toast.error(errorMessage(err)))}>
                <Download /> Problem report
              </Button>
            )}
            {['validated', ...RUNNING].includes(imp.status) && (
              <Button variant="ghost" className="text-red-600 hover:bg-red-50" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                <X /> Cancel
              </Button>
            )}
            {imp.status === 'validated' && (
              <Button disabled={!c.valid} loading={start.isPending} onClick={() => start.mutate()}>
                <ListChecks /> {c.invalid ? `Import ${formatNumber(c.valid)} ready products, skip the rest` : `Import ${formatNumber(c.valid)} products`}
              </Button>
            )}
            {finished && (
              <>
                <Button variant="outline" asChild>
                  <Link to="/vendor/products">View products</Link>
                </Button>
                <Button onClick={onReset}>
                  <Upload /> Upload another file
                </Button>
              </>
            )}
            {imp.status === 'validated' && (
              <Button variant="outline" onClick={onReset}>
                Upload a different file
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {(c.invalid > 0 || c.failed > 0 || finished) && <ItemsTable id={id} defaultFilter={c.invalid || c.failed ? 'problems' : ''} running={running} />}
    </>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={cn('tabular mt-1 text-2xl font-semibold', tone === 'success' && 'text-emerald-700', tone === 'danger' && 'text-red-600')}>
        {formatNumber(value)}
      </p>
    </div>
  )
}

function ItemsTable({ id, defaultFilter, running }) {
  const [filter, setFilter] = useState(defaultFilter)
  const [page, setPage] = useState(1)
  const query = { page, limit: 25, ...(filter ? { status: filter } : {}) }
  const { data, isLoading } = useQuery({
    queryKey: vendorKeys.importItems(id, query),
    queryFn: () => vendorApi.importItems(id, query),
    refetchInterval: running ? 3000 : false,
  })
  return (
    <Card>
      <CardHeader
        title="Rows"
        action={
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={(v) => (setFilter(v), setPage(1))}
            options={[
              { value: 'problems', label: 'Problems' },
              { value: '', label: 'All' },
            ]}
          />
        }
      />
      <DataTable
        loading={isLoading}
        rows={data?.items ?? []}
        empty={{ title: filter ? 'No problems' : 'No rows' }}
        columns={[
          {
            key: 'row',
            header: 'Row',
            cell: (it) => <span className="tabular text-slate-500">{it.rows.length > 1 ? `${it.rows[0]}–${it.rows.at(-1)}` : it.rows[0]}</span>,
          },
          {
            key: 'product',
            header: 'Product',
            cell: (it) => (
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{it.name ?? '—'}</p>
                {it.sku && <p className="text-xs text-slate-500">SKU {it.sku}</p>}
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (it) => <StateBadge map={ITEM_STATUS} status={it.status} /> },
          {
            key: 'issues',
            header: 'Details',
            cell: (it) =>
              it.issues.length ? (
                <ul className="flex flex-col gap-1 text-xs">
                  {it.issues.slice(0, 5).map((i, n) => (
                    <li key={n} className={it.status === 'invalid' || it.status === 'failed' ? 'text-red-700' : 'text-amber-700'}>
                      {i.column && <Badge className="mr-1.5">{i.column}</Badge>}
                      {i.row && it.rows.length > 1 ? `Row ${i.row}: ` : ''}
                      {i.message}
                    </li>
                  ))}
                  {it.issues.length > 5 && <li className="text-slate-500">+{it.issues.length - 5} more in the problem report</li>}
                </ul>
              ) : it.product ? (
                <Link to={`/vendor/products/${it.product}`} className="text-sm font-medium text-primary hover:underline">
                  Open product
                </Link>
              ) : null,
          },
        ]}
      />
      <Pagination meta={data?.meta} onPageChange={setPage} />
    </Card>
  )
}

/* ─────────────── Sidebar ─────────────── */

function HowItWorks() {
  const { data: columns = [] } = useQuery({ queryKey: vendorKeys.importColumns, queryFn: vendorApi.importColumns, staleTime: Infinity })
  const fail = (err) => toast.error(errorMessage(err))
  return (
    <Card>
      <CardHeader title="How it works" />
      <CardBody className="flex flex-col gap-4 text-sm text-slate-700">
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>Download the template and fill one row per product. Keep the header row.</li>
          <li>
            For variants, give rows the same <code className="rounded bg-slate-100 px-1">handle</code> and set option names on the first row.
          </li>
          <li>Images: paste public image links separated by |. Broken links are skipped, not fatal.</li>
          <li>Save as CSV and upload. Fix any flagged rows, then confirm.</li>
        </ol>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => vendorApi.downloadTemplate().catch(fail)}>
            <Download /> Download template
          </Button>
          <Button variant="outline" onClick={() => vendorApi.downloadCategories().catch(fail)}>
            <Download /> Category list
          </Button>
          <Button variant="ghost" onClick={() => vendorApi.exportProducts().catch(fail)}>
            <Download /> Export my products
          </Button>
        </div>
        {columns.length > 0 && (
          <details>
            <summary className="cursor-pointer font-medium text-slate-900">Column guide</summary>
            <dl className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 text-xs">
              {columns.map((c) => (
                <div key={c.key}>
                  <dt className="font-mono font-medium text-slate-900">
                    {c.key}
                    {c.required && <span className="text-red-600"> *</span>}
                  </dt>
                  {c.help && <dd className="text-slate-600">{c.help}</dd>}
                </div>
              ))}
            </dl>
          </details>
        )}
      </CardBody>
    </Card>
  )
}

function History({ currentId, onOpen }) {
  const params = { page: 1, limit: 8 }
  const { data } = useQuery({ queryKey: vendorKeys.imports(params), queryFn: () => vendorApi.imports(params) })
  if (!data?.items?.length) return null
  return (
    <Card>
      <CardHeader title="Recent uploads" />
      <ul className="divide-y divide-slate-100">
        {data.items.map((imp) => (
          <li key={imp._id}>
            <button
              type="button"
              onClick={() => onOpen(imp._id)}
              className={cn('flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-slate-50', imp._id === currentId && 'bg-slate-50')}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">{imp.fileName ?? 'Import'}</span>
                <span className="text-xs text-slate-500">
                  {formatDateTime(imp.createdAt)} · {formatNumber(imp.counts.created + imp.counts.updated)}/{formatNumber(imp.counts.valid)} saved
                </span>
              </span>
              <StateBadge map={IMPORT_STATUS} status={imp.status} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
