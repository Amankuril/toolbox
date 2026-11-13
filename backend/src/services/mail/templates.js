const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Sign-in code email: short subject with the code (shows in notifications), plain-text twin for every client. */
export function otpEmail({ app, otp, minutes }) {
  const subject = `${otp} is your ${app} sign-in code`;
  const text = [
    `Your ${app} sign-in code is ${otp}.`,
    '',
    `It expires in ${minutes} minutes. Do not share it with anyone; ${app} will never ask you for it.`,
    '',
    "If you didn't try to sign in, you can ignore this email.",
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:700;padding-bottom:16px">${escapeHtml(app)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;padding-bottom:16px">Use this code to sign in:</td></tr>
<tr><td style="font-size:32px;font-weight:700;letter-spacing:8px;padding:12px 0 20px;font-family:SFMono-Regular,Menlo,Consolas,monospace">${escapeHtml(otp)}</td></tr>
<tr><td style="font-size:13px;line-height:1.5;color:#475569">It expires in ${minutes} minutes. Do not share it with anyone; ${escapeHtml(app)} will never ask you for it.<br><br>If you didn't try to sign in, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

const inr = (paise) => `₹${((paise ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Order confirmation for the buyer, sent with the confirmation PDF attached.
 * `logoCid` names an inline image attachment (omit for no logo).
 */
export function orderConfirmationEmail({ app, order, orderUrl, payments, logoCid, support }) {
  const a = order.amounts;
  const ship = order.shippingAddress;
  const name = (order.billing?.name || ship.name || '').split(' ')[0];
  const subject = `Order confirmed: ${order.orderNumber} (${inr(a.total)})`;
  const items = order.items.filter((i) => i.status !== 'cancelled');
  const address = [ship.line1, ship.line2, ship.landmark, [ship.city, ship.state].filter(Boolean).join(', '), ship.pincode]
    .filter(Boolean)
    .join(', ');
  const allPickup = order.items.every((i) => (order.pickups ?? []).some((p) => String(p.vendor) === String(i.vendor)));

  const text = [
    `Hi ${name || 'there'},`,
    '',
    `Thank you for shopping with ${app}! Your order ${order.orderNumber} is confirmed.`,
    '',
    ...items.map((i) => `- ${i.name}${i.variant?.title ? ` (${i.variant.title})` : ''} × ${i.quantity}: ${inr(i.lineTotal)}`),
    '',
    `Items total: ${inr(a.subtotal)}`,
    ...(a.discount ? [`Coupon discount: -${inr(a.discount)}`] : []),
    `Delivery: ${a.shipping ? inr(a.shipping) : 'Free'}`,
    `Order total: ${inr(a.total)}`,
    ...payments.map(([l, v]) => `${l}: ${inr(v)}`),
    '',
    allPickup ? `Contact: ${ship.name}, ${ship.phone}` : `Delivering to: ${ship.name}, ${address}. Phone: ${ship.phone}`,
    '',
    'Your order confirmation is attached as a PDF. Each seller issues your GST tax invoice once their items ship; you can download it from My Orders.',
    '',
    `View your order: ${orderUrl}`,
    ...(support ? ['', `Need help? ${support}`] : []),
  ].join('\n');

  const row = (l, v, strong = false) =>
    `<tr><td style="padding:4px 0;color:${strong ? '#0f172a' : '#64748b'};font-size:14px${strong ? ';font-weight:700' : ''}">${escapeHtml(l)}</td><td align="right" style="padding:4px 0;font-size:14px;color:#0f172a${strong ? ';font-weight:700' : ''}">${escapeHtml(v)}</td></tr>`;
  const itemRows = items
    .map(
      (i) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #e3ebe6;font-size:14px;color:#0f172a">
<div style="font-weight:600">${escapeHtml(i.name)}</div>
<div style="font-size:12px;color:#64748b">${i.variant?.title ? `${escapeHtml(i.variant.title)} · ` : ''}Qty ${i.quantity}</div></td>
<td align="right" style="padding:10px 0;border-bottom:1px solid #e3ebe6;font-size:14px;font-weight:600;color:#0f172a;white-space:nowrap">${inr(i.lineTotal)}</td></tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html><body style="margin:0;background:#eef5f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:#1e5b38;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="height:2px;background:#f5c518;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px">${
    logoCid
      ? `<img src="cid:${logoCid}" alt="${escapeHtml(app)}" height="48" style="display:block;height:48px;width:auto;border:0">`
      : `<div style="font-size:20px;font-weight:800;color:#1e5b38">${escapeHtml(app)}</div>`
  }</td></tr>
<tr><td style="padding:12px 28px 0">
<div style="display:inline-block;background:#eef5f0;color:#1e5b38;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:5px 10px;border-radius:999px">&#10003; Order confirmed</div>
<h1 style="margin:14px 0 6px;font-size:22px;line-height:1.3">Thank you${name ? `, ${escapeHtml(name)}` : ''}!</h1>
<p style="margin:0;font-size:14px;line-height:1.6;color:#334155">Your order <strong>${escapeHtml(order.orderNumber)}</strong> has been placed successfully. We'll keep you posted as it ships.</p>
</td></tr>
<tr><td style="padding:20px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table></td></tr>
<tr><td style="padding:12px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row('Items total', inr(a.subtotal))}
${a.discount ? row(`Coupon discount${order.coupon?.code ? ` (${order.coupon.code})` : ''}`, `-${inr(a.discount)}`) : ''}
${row('Delivery', a.shipping ? inr(a.shipping) : 'Free')}
<tr><td colspan="2" style="padding-top:6px;border-top:2px solid #1e5b38"></td></tr>
${row('Order total', inr(a.total), true)}
${payments.map(([l, v]) => row(l, inr(v), l.startsWith('To pay'))).join('')}
</table></td></tr>
<tr><td style="padding:20px 28px 0">
<div style="background:#f7faf8;border:1px solid #e3ebe6;border-radius:8px;padding:14px 16px;font-size:13px;line-height:1.6;color:#334155">
<div style="font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#1e5b38;margin-bottom:4px">${allPickup ? 'Contact' : 'Delivering to'}</div>
<strong style="color:#0f172a">${escapeHtml(ship.name)}</strong><br>${allPickup ? '' : `${escapeHtml(address)}<br>`}Phone: ${escapeHtml(ship.phone)}
</div></td></tr>
<tr><td align="center" style="padding:24px 28px 4px">
<a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#1e5b38;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 26px;border-radius:8px">View your order</a>
</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:12px;line-height:1.6;color:#64748b">
Your order confirmation is attached as a PDF. Each seller issues your GST tax invoice once their items ship; you can download it from My Orders.${
    support ? `<br>Need help? ${escapeHtml(support)}` : ''
  }
</td></tr>
<tr><td style="height:4px;background:#1e5b38;font-size:0;line-height:0">&nbsp;</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
