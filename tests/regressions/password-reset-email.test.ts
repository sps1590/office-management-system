import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { appOrigin, emailConfigured, passwordResetMail } from "@/lib/email";
import {
  consumeResetToken,
  issueResetToken,
  resetTokenIsLive,
  RESET_TTL_MINUTES,
} from "@/lib/password-reset";
import { requestPasswordResetAction, resetPasswordAction } from "@/lib/actions/auth";
import { expectRedirect } from "../stubs/next-navigation";
import { addUser, createTestTenant, form, signInAs, type TestTenant } from "../helpers/world";

/*
   The forgotten-password flow.

   A reset link is a bearer credential for somebody's whole account, so what
   is pinned here is the set of properties that make it safe rather than the
   happy path: the token is stored only as a hash, works once, expires,
   dies when a newer one is issued, and takes the person's other sessions
   with it when it is spent. Plus the one property the screen cannot show —
   that the response is byte-identical for an address that exists and one
   that does not, because a form which distinguishes them is a staff list.

   No mail leaves the machine. `RESEND_API_URL` points at a closed port, so
   `sendEmail` takes its real path and fails the way an outage would; the
   action must still behave. Nothing in `src/` is stubbed.
*/

const DEAD_PORT = "http://127.0.0.1:1/emails";

function withMailer() {
  process.env.RESEND_API_KEY = "re_test_notarealkey";
  process.env.EMAIL_FROM = "oms@vitest.invalid";
  process.env.RESEND_API_URL = DEAD_PORT;
}
function withoutMailer() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.RESEND_API_URL;
}

describe("the mail helpers", () => {
  afterEach(withoutMailer);

  it("reports itself unconfigured until both the key and the from address are set", () => {
    withoutMailer();
    expect(emailConfigured()).toBe(false);
    process.env.RESEND_API_KEY = "re_test";
    // A key with nothing to send from is not a working configuration.
    expect(emailConfigured()).toBe(false);
    process.env.EMAIL_FROM = "oms@vitest.invalid";
    expect(emailConfigured()).toBe(true);
  });

  it("prefers a configured origin over the request's own Host header", () => {
    // A Host header is attacker-controlled, and a reset link built from one
    // can be pointed at somebody else's server.
    process.env.APP_URL = "https://oms.example.com";
    expect(appOrigin("evil.test")).toBe("https://oms.example.com");
    delete process.env.APP_URL;
    expect(appOrigin("evil.test")).toBe("https://evil.test");
    expect(appOrigin("localhost:3000")).toBe("http://localhost:3000");
  });

  it("puts the link in both the text and the HTML part, and escapes what it is given", () => {
    const mail = passwordResetMail({
      name: 'Jaker "Rex" <script>',
      company: "Demo & Co",
      link: "https://oms.example.com/reset-password?token=abc123",
      minutes: RESET_TTL_MINUTES,
    });
    expect(mail.text).toContain("https://oms.example.com/reset-password?token=abc123");
    expect(mail.html).toContain("https://oms.example.com/reset-password?token=abc123");
    // A name is user-supplied and reaches an HTML document.
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("Demo &amp; Co");
  });
});

describe("a reset token", () => {
  let tenant: TestTenant;
  let userId: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Reset Co" });
    userId = await addUser(tenant.tenantId, { roleKey: "employee", name: "Forgetful Person" });
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("is never stored in a form that could be used", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    const db = await getDb();
    const rows = await db`
      SELECT token_hash FROM password_resets
       WHERE user_id = ${userId} AND tenant_id = ${tenant.tenantId} AND used_at IS NULL
    `;
    const stored = (rows[0] as { token_hash: string }).token_hash;
    // Only the SHA-256 is kept: a dump of this table opens nothing.
    expect(stored).not.toBe(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    await consumeResetToken(token);
  });

  it("works once and never again", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    expect(await consumeResetToken(token)).toMatchObject({ userId, tenantId: tenant.tenantId });
    // The second attempt is a replay — of a link forwarded, logged or
    // sitting in a mailbox somebody else now reads.
    expect(await consumeResetToken(token)).toBeNull();
  });

  it("dies when a newer one is issued for the same person", async () => {
    const first = await issueResetToken(tenant.tenantId, userId, null);
    const second = await issueResetToken(tenant.tenantId, userId, null);
    // Asking twice is usually somebody who never received the first, and
    // the first may be in a mailbox they have lost.
    expect(await consumeResetToken(first.token)).toBeNull();
    expect(await consumeResetToken(second.token)).not.toBeNull();
  });

  it("refuses once it has expired", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    const db = await getDb();
    await db`
      UPDATE password_resets SET expires_at = now() - INTERVAL '1 minute'
       WHERE user_id = ${userId} AND tenant_id = ${tenant.tenantId} AND used_at IS NULL
    `;
    expect(await resetTokenIsLive(token)).toBe(false);
    expect(await consumeResetToken(token)).toBeNull();
  });

  it("refuses a token that was never issued", async () => {
    expect(await consumeResetToken("not-a-real-token")).toBeNull();
    expect(await resetTokenIsLive("not-a-real-token")).toBe(false);
  });

  it("is live, and stays live, until it is spent", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    // Checking must not burn it: a mail client that pre-fetches links would
    // otherwise kill every reset before its owner clicked.
    expect(await resetTokenIsLive(token)).toBe(true);
    expect(await resetTokenIsLive(token)).toBe(true);
    expect(await consumeResetToken(token)).not.toBeNull();
    expect(await resetTokenIsLive(token)).toBe(false);
  });
});

describe("asking for a reset link", () => {
  let tenant: TestTenant;
  let email: string;

  const tokensFor = async (userId: string) => {
    const db = await getDb();
    const rows = await db`
      SELECT id FROM password_resets
       WHERE user_id = ${userId} AND tenant_id = ${tenant.tenantId} AND used_at IS NULL
    `;
    return rows.length;
  };

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Oracle Co" });
    const db = await getDb();
    const rows = await db`
      SELECT email FROM users WHERE id = ${tenant.adminId} AND tenant_id = ${tenant.tenantId}
    `;
    email = (rows[0] as { email: string }).email;
  });
  afterAll(async () => {
    withoutMailer();
    await tenant.drop();
  });

  it("answers an unknown address exactly as it answers a real one", async () => {
    withMailer();
    const real = await requestPasswordResetAction(null, form({ email }));
    const fake = await requestPasswordResetAction(
      null,
      form({ email: "nobody-at-all@vitest.invalid" })
    );
    // Byte-identical. Anything that varies turns this form into a list of
    // who works here, readable by anybody with a browser.
    expect(real?.success).toBeTruthy();
    expect(fake?.success).toBe(real?.success);
    expect(real?.error).toBeUndefined();
    expect(fake?.error).toBeUndefined();
    // Behind the identical answer, only the real account got a link.
    expect(await tokensFor(tenant.adminId)).toBe(1);
  });

  it("sends nothing and issues nothing when no provider is configured", async () => {
    withoutMailer();
    const db = await getDb();
    await db`DELETE FROM password_resets WHERE tenant_id = ${tenant.tenantId}`;

    const state = await requestPasswordResetAction(null, form({ email }));
    // It fails closed and says so, rather than reporting a link somebody
    // will wait for forever. The message does not depend on the address.
    expect(state?.error).toMatch(/not switched on/i);
    expect(state?.success).toBeUndefined();
    expect(await tokensFor(tenant.adminId)).toBe(0);
  });

  it("still succeeds when the provider itself is down", async () => {
    withMailer();
    const db = await getDb();
    await db`DELETE FROM password_resets WHERE tenant_id = ${tenant.tenantId}`;
    // RESEND_API_URL is a closed port, so the send genuinely fails. The
    // person must not be told the address does not exist because of it.
    const state = await requestPasswordResetAction(null, form({ email }));
    expect(state?.success).toBeTruthy();
    const audits = await db`
      SELECT summary FROM audit_logs
       WHERE tenant_id = ${tenant.tenantId} AND action = 'auth.password_reset_requested'
    `;
    // The failure is recorded, because an unverified sending domain looks
    // exactly like success from the form's side.
    expect((audits[0] as { summary: string }).summary).toMatch(/could not be emailed/i);
  });

  it("rejects a malformed address before anything else happens", async () => {
    withMailer();
    const state = await requestPasswordResetAction(null, form({ email: "not-an-email" }));
    expect(state?.fieldErrors?.email).toBeTruthy();
  });
});

describe("spending a reset link", () => {
  let tenant: TestTenant;
  let userId: string;

  beforeAll(async () => {
    tenant = await createTestTenant({ companyName: "Spend Co" });
    userId = await addUser(tenant.tenantId, { roleKey: "employee", name: "New Password" });
  });
  afterAll(async () => {
    await tenant.drop();
  });

  it("sets a password that actually signs in, and ends every other session", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    await signInAs(userId, tenant.tenantId);
    const db = await getDb();
    const before = await db`
      SELECT id FROM sessions WHERE user_id = ${userId} AND tenant_id = ${tenant.tenantId}
    `;
    expect(before.length).toBe(1);

    await expectRedirect(
      resetPasswordAction(
        null,
        form({ token, password: "Brand New 99", confirmPassword: "Brand New 99" })
      ),
      "/login?reset=1"
    );

    const rows = await db`
      SELECT password_hash FROM users WHERE id = ${userId} AND tenant_id = ${tenant.tenantId}
    `;
    expect(verifyPassword(rows[0] as { password_hash: string }, "Brand New 99")).toBe(true);

    const after = await db`
      SELECT id FROM sessions WHERE user_id = ${userId} AND tenant_id = ${tenant.tenantId}
    `;
    // The other reason to reset a password is that somebody else has the
    // account. Leaving their cookie alive would make the reset pointless.
    expect(after.length).toBe(0);
  });

  it("refuses the same link a second time", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    await expectRedirect(
      resetPasswordAction(null, form({ token, password: "Second Go 1", confirmPassword: "Second Go 1" })),
      "/login?reset=1"
    );
    const replay = await resetPasswordAction(
      null,
      form({ token, password: "Third Go 11", confirmPassword: "Third Go 11" })
    );
    expect(replay?.error).toMatch(/no longer valid/i);
  });

  it("refuses a weak password and a mismatch without spending the link", async () => {
    const { token } = await issueResetToken(tenant.tenantId, userId, null);
    const weak = await resetPasswordAction(
      null,
      form({ token, password: "short", confirmPassword: "short" })
    );
    expect(weak?.fieldErrors?.password).toBeTruthy();

    const mismatch = await resetPasswordAction(
      null,
      form({ token, password: "Good Enough 1", confirmPassword: "Good Enough 2" })
    );
    expect(mismatch?.fieldErrors?.confirmPassword).toBeTruthy();

    // Neither refusal may burn the link, or one typo would send somebody
    // back to their inbox for a fresh one.
    expect(await resetTokenIsLive(token)).toBe(true);
  });

  it("treats a missing token as a dead link rather than a field error", async () => {
    const state = await resetPasswordAction(
      null,
      form({ password: "Good Enough 1", confirmPassword: "Good Enough 1" })
    );
    expect(state?.error).toMatch(/no longer valid/i);
    expect(state?.fieldErrors).toBeUndefined();
  });

  it("refuses to revive an account that has been suspended", async () => {
    const left = await addUser(tenant.tenantId, { roleKey: "employee", name: "Gone Person" });
    const { token } = await issueResetToken(tenant.tenantId, left, null);
    const db = await getDb();
    await db`
      UPDATE users SET status = 'suspended' WHERE id = ${left} AND tenant_id = ${tenant.tenantId}
    `;
    const state = await resetPasswordAction(
      null,
      form({ token, password: "Let Me In 1", confirmPassword: "Let Me In 1" })
    );
    // Suspended between the email and the click: the link must not be a way
    // back in.
    expect(state?.error).toMatch(/no longer active/i);
  });
});
