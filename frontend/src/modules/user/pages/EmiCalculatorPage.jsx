import { usePublicSettings } from '@/core/settings/usePublicSettings'
import { Card, CardBody } from '@/ui/Card'
import { EmiCalculator } from '../components/EmiCalculator'

/** /emi-calculator: plan a purchase before choosing a product. */
export default function EmiCalculatorPage() {
  const { data: settings } = usePublicSettings()
  const siteName = settings?.branding?.siteName ?? 'ToolsHubs'
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <title>{`EMI calculator | ${siteName}`}</title>
      <meta name="description" content={`Work out your monthly EMI for tools and machinery on ${siteName}. Card and cardless EMI at checkout.`} />
      <p className="eyebrow">Pay in instalments</p>
      <h1 className="mt-1 mb-6 font-display text-3xl font-extrabold tracking-tight text-slate-900">EMI calculator</h1>
      <Card>
        <CardBody>
          {settings?.payments?.emiEnabled ? (
            <EmiCalculator initialAmount={Math.max(settings.payments.emiMinOrderValue, 25_000_00)} payments={settings.payments} />
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">EMI isn't available right now.</p>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
