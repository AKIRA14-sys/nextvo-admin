import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedAdmin } from "@/lib/supabase/config";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
const protectedPaths = ["/dashboard", "/products", "/import", "/categories", "/inventory", "/orders", "/customers", "/profit", "/analytics", "/settings", "/account"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requiresAdmin = protectedPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  if (!url || !key) {
    if (requiresAdmin) return NextResponse.redirect(new URL("/login?setup=1", request.url));
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });
  const { data: { user } } = await supabase.auth.getUser();

  if (pathname === "/") {
    const destination = user && isAuthorizedAdmin(user) ? "/dashboard" : "/login";
    return NextResponse.redirect(new URL(destination, request.url));
  }
  if (requiresAdmin && (!user || !isAuthorizedAdmin(user))) {
    const destination = user ? "/unauthorized" : "/login";
    return NextResponse.redirect(new URL(destination, request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|sw.js|offline.html|manifest.webmanifest).*)"]
};
