export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "";
export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_KEY);
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "NEXTVO";
export const STORE_CURRENCY = process.env.NEXT_PUBLIC_STORE_CURRENCY || "NGN";
export const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL || "").replace(/\/$/, "");

export function isAuthorizedAdmin(user: { app_metadata?: Record<string, unknown> } | null | undefined) {
  const metadata = user?.app_metadata || {};
  const role = String(metadata.role || metadata.admin_role || "").toLowerCase();
  return metadata.is_admin === true || ["admin", "super_admin"].includes(role);
}
