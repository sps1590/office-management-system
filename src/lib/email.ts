import "server-only";

/*
   Outbound email.

   One provider, reached over its HTTPS API with `fetch` rather than an SDK:
   the brief asks for the most optimised design, and the whole integration is
   the forty lines below. SMTP was the alternative and is the wrong shape for
   a serverless function — it wants a long-lived TCP socket and a library to
   speak it.

   Nothing here throws. A send that fails must never take a password reset or
   an approval notice down with it; the caller decides what to tell the person
   and what to write to the audit log.
*/

export type Mail = {
  to: string;
  subject: string;
  /** Both parts are always sent: some clients, and most filters, want text. */
  text: string;
  html: string;
};

export type SendResult = { sent: boolean; error?: string };

/**
 * Whether a provider is configured at all.
 *
 * Checked before anything that depends on delivery, so the screen can say
 * "this is not set up" instead of silently doing nothing. The answer is the
 * same for every address, so it is not an account-existence oracle.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(mail: Mail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { sent: false, error: "No email provider is configured." };

  // The endpoint is overridable so a deployment can route through its own
  // gateway, and so the suite can exercise this path without sending mail.
  const endpoint = process.env.RESEND_API_URL ?? "https://api.resend.com/emails";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
      // A password reset that hangs would hold the form open until the
      // function times out; better to fail and let them ask again.
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // The body carries the provider's reason — an unverified sending
      // domain, most often. Never logged with the mail's contents.
      const detail = await response.text().catch(() => "");
      return { sent: false, error: `Mail provider refused the message (${response.status}). ${detail.slice(0, 200)}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : "Send failed." };
  }
}

/**
 * The absolute origin to build links on.
 *
 * `APP_URL` first, then the origin Vercel sets for the production deployment,
 * and only then the request's own Host — which is attacker-controllable, and
 * is how a reset link gets rewritten to point at somebody else's server. The
 * fallback exists for `next dev`, where neither variable is set.
 */
export function appOrigin(requestHost?: string | null): string {
  const configured = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  if (requestHost) {
    const scheme = requestHost.startsWith("localhost") || requestHost.startsWith("127.") ? "http" : "https";
    return `${scheme}://${requestHost}`;
  }
  return "http://localhost:3000";
}

/** Minimal escaping for the values interpolated into an HTML mail body. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The reset message.
 *
 * Table-based and inline-styled, because that is what mail clients render —
 * Outlook has no grid, no custom properties and no external stylesheet, so
 * the design tokens cannot come along. Deliberately plain, and it says what
 * to do if the request was not theirs.
 */
export function passwordResetMail(options: {
  name: string;
  company: string;
  link: string;
  minutes: number;
}): Pick<Mail, "subject" | "text" | "html"> {
  const { name, company, link, minutes } = options;
  const subject = `Reset your ${company} password`;
  const text = [
    `Hello ${name},`,
    ``,
    `Somebody asked to reset the password for your ${company} account.`,
    `Open this link to choose a new one. It works once and expires in ${minutes} minutes:`,
    ``,
    link,
    ``,
    `If that was not you, ignore this message — your password has not changed,`,
    `and the link cannot be used without this email.`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f6fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px">
    <tr><td style="padding:28px 28px 8px">
      <p style="margin:0;font-size:13px;letter-spacing:.02em;text-transform:uppercase;color:#8b97a8">${esc(company)}</p>
      <h1 style="margin:10px 0 0;font-size:20px;font-weight:650">Reset your password</h1>
    </td></tr>
    <tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.6;color:#5b6878">
      <p style="margin:0 0 14px">Hello ${esc(name)},</p>
      <p style="margin:0 0 14px">Somebody asked to reset the password for your account. Choose a new one with the button below — it works once, and expires in ${minutes} minutes.</p>
    </td></tr>
    <tr><td style="padding:20px 28px 4px">
      <a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px">Choose a new password</a>
    </td></tr>
    <tr><td style="padding:18px 28px 28px;font-size:13px;line-height:1.6;color:#8b97a8">
      <p style="margin:0 0 10px">Or paste this into your browser:</p>
      <p style="margin:0 0 18px;word-break:break-all;color:#5b6878">${esc(link)}</p>
      <p style="margin:0">If this was not you, ignore this message. Your password has not changed, and the link cannot be used by anybody who does not have this email.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}
