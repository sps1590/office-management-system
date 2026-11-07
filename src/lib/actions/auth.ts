"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import {
  createSession,
  destroySession,
  findUserByEmail,
  getSessionUser,
  hashPassword,
  setUserTheme,
  verifyPassword,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { provisionTenant } from "@/lib/provision";
import { allow, loginBucket, resetBucket, resetIpBucket, signupBucket } from "@/lib/rate-limit";
import { appOrigin, emailConfigured, passwordResetMail, sendEmail } from "@/lib/email";
import {
  consumeResetToken,
  issueResetToken,
  RESET_TTL_MINUTES,
} from "@/lib/password-reset";
import { audit } from "@/lib/audit";
import { isKnownTimeZone, slugify } from "@/lib/utils";
import type { ActionState } from "@/lib/types";

// Deliberately identical for "no such account" and "wrong password", so the
// login form is never an account-existence oracle.
const GENERIC_LOGIN_ERROR = "Email or password is incorrect.";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export async function loginAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { email, password } = parsed.data;

  if (!(await allow(loginBucket(email), 10, 600))) {
    return { error: "Too many sign-in attempts. Please try again in a few minutes." };
  }

  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(user, password)) {
    return { error: GENERIC_LOGIN_ERROR };
  }
  if (user.status === "suspended" || user.status === "left") {
    return { error: "This account is no longer active. Contact your administrator." };
  }

  // A suspended company is refused at the door as well as inside the app.
  const db = await getDb();
  const tenantRows = await db`
    SELECT status FROM tenants WHERE id = ${user.tenant_id}
  `;
  const status = (tenantRows[0] as { status: string } | undefined)?.status;
  if (status === "suspended" || status === "cancelled") {
    return {
      error:
        "Your company's account is suspended. Please contact your administrator or the OMS operator.",
    };
  }

  await createSession(user.id, user.tenant_id);
  await audit({
    tenantId: user.tenant_id,
    userId: user.id,
    action: "auth.login",
    summary: `${user.full_name} signed in`,
  });
  redirect("/dashboard");
}

const registerSchema = z
  .object({
    companyName: z.string().trim().min(2, "Company name is required").max(120),
    adminName: z.string().trim().min(2, "Your name is required").max(120),
    email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
    phone: z.string().trim().max(32).optional(),
    country: z.string().trim().max(60).optional(),
    currency: z.string().trim().length(3).default("BDT"),
    timezone: z.string().trim().max(60).optional(),
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(200)
      .regex(/[a-z]/, "Include a lower-case letter")
      .regex(/[A-Z]/, "Include an upper-case letter")
      .regex(/[0-9]/, "Include a number"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export async function registerAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    companyName: formData.get("companyName"),
    adminName: formData.get("adminName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    country: formData.get("country") || undefined,
    currency: formData.get("currency") || "BDT",
    timezone: formData.get("timezone") || undefined,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const data = parsed.data;

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!(await allow(signupBucket(ip), 5, 3600))) {
    return { error: "Too many companies registered from this network. Try again later." };
  }

  const db = await getDb();
  const existing = await db`
    SELECT 1 FROM users WHERE LOWER(email) = LOWER(${data.email})
    -- tenancy-ok: email is globally unique, checked before any tenant exists
  `;
  if (existing.length > 0) {
    return { fieldErrors: { email: ["That email is already registered. Sign in instead."] } };
  }

  // Company slugs are globally unique; append a counter rather than rejecting
  // a legitimate duplicate company name.
  const base = slugify(data.companyName) || "company";
  let slug = base;
  for (let i = 2; i < 50; i++) {
    const taken = await db`SELECT 1 FROM tenants WHERE slug = ${slug}
                           -- tenancy-ok: global uniqueness check on the tenant table itself`;
    if (taken.length === 0) break;
    slug = `${base}-${i}`;
  }

  const { tenantId, userId } = await provisionTenant({
    companyName: data.companyName,
    slug,
    adminName: data.adminName,
    adminEmail: data.email,
    passwordHash: hashPassword(data.password),
    phone: data.phone ?? null,
    country: data.country ?? null,
    currency: data.currency.toUpperCase(),
    // An unknown string here would make every page fall back to UTC, so
    // only a zone the runtime recognises is kept.
    timezone:
      data.timezone && isKnownTimeZone(data.timezone) ? data.timezone : undefined,
  });

  await createSession(userId, tenantId);
  await audit({
    tenantId,
    userId,
    action: "tenant.created",
    entity: "tenant",
    entityId: tenantId,
    summary: `Company "${data.companyName}" registered`,
  });
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const user = await getSessionUser();
  if (user) {
    await audit({
      tenantId: user.tenant_id,
      userId: user.id,
      action: "auth.logout",
      summary: `${user.full_name} signed out`,
    });
  }
  await destroySession();
  redirect("/login");
}

const themeSchema = z.enum(["light", "dark", "system"]);

/** Persists the theme choice so it follows the user to another device. */
export async function setThemeAction(theme: string): Promise<void> {
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) return;
  const user = await getSessionUser();
  if (!user) return;
  await setUserTheme(user.id, parsed.data);
}

/* -------------------------------------------------------------------------
   Forgotten passwords

   Two actions, both reachable without a session, which is the whole point
   and also the reason every refusal below is worded the same way. The
   security properties, in one place so they are not lost in the code:

   - The confirmation never varies with whether the address exists. A form
     that says "no such account" is a list of who works here, readable by
     anybody.
   - The link goes to the mailbox and nowhere else. It is never rendered on
     screen, or anyone could reset anyone's password from the form.
   - Rate limited per address and per IP, because the first stops one
     account being flooded and the second stops the form being used to send
     mail to a list of addresses.
   - Spending a link ends that person's other sessions. A reset usually
     means the password was lost or the account was taken, and in the second
     case leaving the attacker's cookie alive makes the reset pointless.
   ------------------------------------------------------------------------- */

const forgotSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
});

// Identical whether or not the address belongs to anybody.
const RESET_SENT =
  "If that address belongs to an account, a reset link is on its way. " +
  "It expires in an hour — check the spam folder if it does not arrive.";

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = forgotSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { email } = parsed.data;

  /*
     Answered before the lookup, and the same for every address, so it tells
     an attacker nothing about who has an account — only that this
     deployment cannot send mail yet.
  */
  if (!emailConfigured()) {
    return {
      error:
        "Password reset by email is not switched on for this deployment. " +
        "Ask your company administrator to reset it for you from the Users screen.",
    };
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!(await allow(resetBucket(email), 3, 900)) || !(await allow(resetIpBucket(ip), 10, 900))) {
    return { error: "Too many reset requests. Please try again in a few minutes." };
  }

  const user = await findUserByEmail(email);
  // Everything from here is silent: the caller gets RESET_SENT either way.
  if (user && user.status !== "suspended" && user.status !== "left") {
    const db = await getDb();
    const tenantRows = await db`
      SELECT company_name, status FROM tenants WHERE id = ${user.tenant_id}
    `;
    const tenant = tenantRows[0] as { company_name: string; status: string } | undefined;

    if (tenant && tenant.status !== "suspended" && tenant.status !== "cancelled") {
      const { token } = await issueResetToken(user.tenant_id, user.id, ip);
      const host = (await headers()).get("host");
      const link = `${appOrigin(host)}/reset-password?token=${encodeURIComponent(token)}`;
      const mail = passwordResetMail({
        name: user.full_name,
        company: tenant.company_name,
        link,
        minutes: RESET_TTL_MINUTES,
      });
      const result = await sendEmail({ to: user.email, ...mail });

      await audit({
        tenantId: user.tenant_id,
        userId: user.id,
        action: "auth.password_reset_requested",
        entity: "user",
        entityId: user.id,
        summary: result.sent
          ? `A password reset link was emailed to ${user.email}`
          : `A password reset link could not be emailed to ${user.email}`,
        // The failure reason is worth keeping: an unverified sending domain
        // looks exactly like a working reset from the form's side.
        meta: result.sent ? {} : { error: result.error ?? "unknown" },
      });
    }
  }

  return { success: RESET_SENT };
}

const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(200)
      .regex(/[a-z]/, "Include a lower-case letter")
      .regex(/[A-Z]/, "Include an upper-case letter")
      .regex(/[0-9]/, "Include a number"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

const DEAD_LINK =
  "This reset link is no longer valid — it may have expired, or already been used. " +
  "Request a new one below.";

export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    // A missing or malformed token is not something a person can fix in a
    // field, so it is reported as the link being dead rather than as a
    // validation error on an input they cannot see.
    if (fieldErrors.token) return { error: DEAD_LINK };
    return { fieldErrors };
  }
  const { token, password } = parsed.data;

  const spent = await consumeResetToken(token);
  if (!spent) return { error: DEAD_LINK };

  const db = await getDb();
  const updated = await db`
    UPDATE users
       SET password_hash = ${hashPassword(password)}, updated_at = now()
     WHERE id = ${spent.userId} AND tenant_id = ${spent.tenantId}
       AND status NOT IN ('suspended', 'left')
    RETURNING full_name, email
  `;
  if (updated.length === 0) {
    return { error: "This account is no longer active. Contact your administrator." };
  }
  const target = updated[0] as { full_name: string; email: string };

  await db`
    DELETE FROM sessions WHERE user_id = ${spent.userId} AND tenant_id = ${spent.tenantId}
  `;
  await audit({
    tenantId: spent.tenantId,
    userId: spent.userId,
    action: "auth.password_reset",
    entity: "user",
    entityId: spent.userId,
    summary: `${target.full_name} set a new password from an emailed link, ending their other sessions`,
  });

  // Not signed in automatically: whoever opened the link proved they can
  // read the mailbox, not that they know the password they just set. One
  // sign-in with it is the proof, and it is one field away.
  redirect("/login?reset=1");
}
