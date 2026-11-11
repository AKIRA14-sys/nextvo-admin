import { redirect } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { isAuthorizedAdmin } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/login?setup=1");
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  if (!isAuthorizedAdmin(user)) redirect("/unauthorized");
  return <AdminShell email={user.email || "Admin"}>{children}</AdminShell>;
}
