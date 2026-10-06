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
