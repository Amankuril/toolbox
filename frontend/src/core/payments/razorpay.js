const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js'
let loading = null

function loadScript() {
  if (window.Razorpay) return Promise.resolve()
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error('Could not load the payment window. Check your connection and try again.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

/**
 * Opens Razorpay Checkout for a server-created order.
 * Resolves with { status: 'paid', providerOrderId, paymentId, signature } | { status: 'dismissed', reason? }.
 * The server verifies the signature; nothing here is trusted on its own.
 */
export async function openRazorpayCheckout({ payment, name, description, color }) {
  await loadScript()
  return new Promise((resolve) => {
    let settled = false
    let lastFailure
    const done = (result) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    const rzp = new window.Razorpay({
      key: payment.keyId,
      order_id: payment.providerOrderId,
      amount: payment.amount,
      currency: payment.currency,
      name,
      description,
      prefill: payment.prefill,
      theme: { color },
      retry: { enabled: true },
      handler: (res) => done({ status: 'paid', providerOrderId: res.razorpay_order_id, paymentId: res.razorpay_payment_id, signature: res.razorpay_signature }),
      modal: { ondismiss: () => done({ status: 'dismissed', reason: lastFailure }), confirm_close: true },
    })
    // A failed attempt doesn't close the modal (the customer can retry); remember the reason in case they give up.
    rzp.on('payment.failed', (res) => {
      lastFailure = res?.error?.description
    })
    rzp.open()
  })
}
