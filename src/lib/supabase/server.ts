import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_CONFIGURED, SUPABASE_KEY, SUPABASE_URL } from "./config";

export async function getSupabaseServerClient() {
  if (!SUPABASE_CONFIGURED) return null;
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot always write refreshed cookies; middleware handles refresh.
        }
      }
    }
  });
}
