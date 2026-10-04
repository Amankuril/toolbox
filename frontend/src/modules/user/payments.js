import { toast } from 'sonner'
import { openRazorpayCheckout } from '@/core/payments/razorpay'
import { userApi } from './api'

/**
 * Opens the gateway for an order and verifies the result with the API.
 * Returns { status: 'paid' | 'verifying' | 'dismissed' | 'failed', error?: string }.
 * Protects against duplicate payments when network fails after gateway capture.
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
    return { status: 'failed', error: err.message }
  }

  if (result.status !== 'paid') {
    if (result.reason) userApi.paymentFailed(order._id, result.reason).catch(() => {})
    toast.info('Payment not completed. You can retry from your order page.')
    return { status: 'dismissed' }
  }

  try {
    await userApi.verifyPayment(order._id, {
      providerOrderId: result.providerOrderId,
      paymentId: result.paymentId,
      signature: result.signature,
    })
    return { status: 'paid' }
  } catch {
    // If the network or server verification timed out after money was charged,
    // do NOT tell user "failed" or encourage duplicate payments.
    toast.info('Payment status is being verified. Please do not make another payment yet.', {
      duration: 6000,
    })
    return { status: 'verifying' }
  }
}
