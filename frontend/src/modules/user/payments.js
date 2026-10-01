import { toast } from 'sonner'
import { errorMessage } from '@/core/api/errors'
import { openRazorpayCheckout } from '@/core/payments/razorpay'
import { userApi } from './api'

/**
 * Opens the gateway for an order and verifies the result with the API.
 * Returns true when the order is confirmed paid. Webhooks confirm payments too, so a closed tab is safe.
 */
export async function payForOrder({ order, payment, siteName }) {
  let result
  try {
    result = await openRazorpayCheckout({
      payment,
      name: siteName,
      description: `Order ${order.orderNumber}`,
      color: getComputedStyle(document.documentElement).getPropertyValue('--tb-primary').trim() || undefined,
    })
  } catch (err) {
    toast.error(err.message)
    return false
  }

  if (result.status !== 'paid') {
    if (result.reason) userApi.paymentFailed(order._id, result.reason).catch(() => {})
    toast.info('Payment not completed. You can retry from your order page.')
    return false
  }
  try {
    await userApi.verifyPayment(order._id, { providerOrderId: result.providerOrderId, paymentId: result.paymentId, signature: result.signature })
    return true
  } catch (err) {
    toast.error(errorMessage(err))
    return false
  }
}
