import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_CONFIGURED, SUPABASE_KEY, SUPABASE_URL } from "./config";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;
export function getSupabaseBrowserClient() {
  if (!SUPABASE_CONFIGURED) throw new Error("Supabase is not configured. Add the public project URL and publishable/anon key in Vercel.");
  browserClient ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return browserClient;
}
