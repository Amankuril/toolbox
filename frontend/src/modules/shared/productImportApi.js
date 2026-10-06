import { list, one } from '@/core/api/http'

/** Fetches a file through the authenticated client and saves it (keeps the token out of URLs). */
async function download(client, path, params, fallbackName) {
  const res = await client.get(path, { params, responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? fallbackName
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Bulk import endpoints for one panel. Vendors work on their own catalogue; admins pass `vendorId`.
 * @param {import('axios').AxiosInstance} client
 */
export function createImportApi(client) {
  const base = '/product-imports'
  const forVendor = (vendorId) => (vendorId ? { vendorId } : {})
  return {
    list: (params) => list(client.get(base, { params })),
    get: (id) => one(client.get(`${base}/${id}`)),
    items: (id, params) => list(client.get(`${base}/${id}/items`, { params })),
    columns: () => one(client.get(`${base}/columns`)),
    upload: ({ file, mode, vendorId, onUploadProgress }) => {
      const body = new FormData()
      body.append('mode', mode)
      if (vendorId) body.append('vendorId', vendorId)
      body.append('file', file)
      return one(client.post(base, body, { onUploadProgress, timeout: 120_000 }))
    },
    start: (id) => one(client.post(`${base}/${id}/start`)),
    cancel: (id) => one(client.post(`${base}/${id}/cancel`)),
    downloadTemplate: (format, vendorId) => download(client, `${base}/template`, { format, ...forVendor(vendorId) }, `products-template.${format}`),
    downloadCategories: (vendorId) => download(client, `${base}/categories.csv`, forVendor(vendorId), 'categories.csv'),
    downloadIssues: (id) => download(client, `${base}/${id}/issues.csv`, undefined, 'import-problems.csv'),
    exportProducts: (format, vendorId) => download(client, `${base}/export`, { format, ...forVendor(vendorId) }, `products.${format}`),
  }
}
