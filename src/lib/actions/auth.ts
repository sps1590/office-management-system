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
import { allow, loginBucket, signupBucket } from "@/lib/rate-limit";
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
