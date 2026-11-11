# NEXTVO Admin

A standalone, mobile-first web dashboard and installable PWA for managing the NEXTVO catalogue. It is its own Next.js application and GitHub repository; it shares the existing storefront's Supabase project rather than creating a second catalogue.

## What is in this project

The dashboard includes Supabase Auth login/password recovery, protected admin routes, catalogue search and product editing, image upload/reordering, product variants, publication controls, category/subcategory management, audited stock adjustments, order fulfilment status, a restricted customer directory, product-link metadata import/review, import history, a read-only verified-payment ledger, an estimated-profit calculator, real-data analytics, store settings, account/session controls, and a network-only PWA shell with an offline fallback. It does not seed invented products, customers, orders, prices or revenue.

Supplier import only fetches public HTTPS page metadata and structured data. It checks DNS addresses and redirects, rejects private/internal targets, pins DNS for the request, and limits redirects, response size and timeout. It does not work around CAPTCHA, login, paywalls or anti-bot controls. Imported copy and images must be reviewed; stock must be verified manually.

## Setup in the existing Supabase project

1. Open the existing NEXTVO Supabase project (`eagalzikryikfibqcpsr`), not a new project.
2. Review and run [`supabase/admin-setup.sql`](supabase/admin-setup.sql) in the SQL Editor. The SQL adds private supplier details, inventory and import history, protected settings, admin-only catalogue-write policies, a narrow customer-count/list API, status-only order updates, atomic product/stock RPCs, and a read-only verified-payment ledger with revenue RPCs. It also adds catalogue tables to Supabase Realtime when that publication is available. Browser-authenticated users receive no write grant on the payment ledger.
3. Confirm the existing public `product-images` Storage bucket and its public read path are present. Admin image writes are separately restricted to an authenticated admin.
4. Ensure the intended administrator already exists in Supabase Auth. Assign `{"role":"super_admin"}` only to that account's trusted **app metadata**. If using the SQL Editor, first obtain that account's Auth user UUID and run this one-time, account-specific statement there:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"super_admin"}'::jsonb
   where id = 'THE_EXISTING_ADMIN_AUTH_USER_UUID';
   ```

   Do not put this role in user metadata, browser code, a customer profile or local storage. Sign out and sign in again to refresh the role claim. Only `admin` and `super_admin` are accepted in this release; the other planned job roles do not yet have separate permissions.
5. In Supabase Auth URL settings, allow the deployed Admin origin's `/auth/callback` redirect (and `http://localhost:3000/auth/callback` for local development). Password-recovery redirects are built from the current Admin origin.

The SQL file is a setup script, not a report of changes already applied. Review it against the live schema and take the usual database backup before applying production DDL. No Supabase service-role key is needed or used by this app.

## Environment variables

Set these on the **Admin** Vercel project. The publishable key is public configuration; it is not an administrator credential.

| Variable | Requirement | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Required | `https://eagalzikryikfibqcpsr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required (preferred) | The existing project's publishable key from Supabase API settings. If that project only exposes an anon key, set `NEXT_PUBLIC_SUPABASE_ANON_KEY` instead. |
| `NEXT_PUBLIC_STOREFRONT_URL` | Required for product links/sharing | The real customer storefront origin, without a trailing slash. The current storefront route is `/products/<slug>`. |
| `NEXT_PUBLIC_STORE_NAME` | Optional; defaults to `NEXTVO` | `NEXTVO` |
| `NEXT_PUBLIC_STORE_CURRENCY` | Optional; defaults to `NGN` | `NGN` |
| `NEXT_PUBLIC_SITE_URL` | Optional for this build | Admin's own deployed origin; auth redirects derive from the browser's current origin today. |

There are **no private server environment variables required** in this version. Do not add `SUPABASE_SERVICE_ROLE_KEY` to Vercel, this repository, or any `NEXT_PUBLIC_*` variable.

For local development, copy `.env.example` to `.env.local`, fill the two Supabase public settings and the storefront URL, then run `npm install` and `npm run dev`.

## Deploy separately with Vercel

1. Import `AKIRA14-sys/nextvo-admin` as a new Vercel project. Keep the project root at `/` and use the Next.js framework preset.
2. Add the environment variables above to Preview and Production. Add them before the production build.
3. Deploy `main`. Vercel's normal Next.js install/build settings use `npm install` and `npm run build`.
4. Add the deployed Admin URL to Supabase Auth's allowed redirect URLs.
5. Open the HTTPS Admin URL in Chrome on Android. Use Chrome's menu → **Install app** or **Add to Home screen**. The service worker caches only the offline fallback and icon files; Admin pages, API calls and private data remain network-only.

## Important boundaries and not-yet-configured work

- The Admin app has **not** been connected to Vercel or deployed here. The user supplies Vercel settings and domain from their phone.
- The database SQL has **not** been applied or exercised against the live project in this build environment. No admin role, key or live catalogue connection was present, so live product-write, RLS, Storage and end-to-end synchronization tests remain outstanding.
- Admin mutations use the shared Supabase tables, so new/edited/published catalogue rows are written without a storefront redeploy. The existing storefront repository was intentionally left untouched. A server-side on-demand revalidation/webhook and the requested customer-facing SEO follow-up still need a separately reviewed storefront change; this code alone cannot guarantee instant refresh of an already-rendered or browser-cached storefront page.
- The storefront currently exposes `/products/<slug>` links. The Admin builds those links from `NEXT_PUBLIC_STOREFRONT_URL`; it does not create a second storefront or an Admin-only product route. The login “remember” option stores only the email address on that device; it never stores the password or tokens.
- The existing storefront README says checkout is disabled and no provider/webhook exists. The Orders view never treats its legacy `orders.payment_status` value as proof of payment. Revenue and Analytics read only `nextvo_verified_payments`; the Admin payment page is read-only, and only a separately configured trusted server/webhook can populate this ledger. Until then, verified sales correctly remain empty.
- Analytics are constrained to fields and records available in the existing schema. No sales, profit, payment or customer-growth values are synthesized. The profit calculator is an estimate, not realized profit.
- Store settings are limited to the Admin extension and are not wired to customer-facing behavior. Push notifications, Firebase and FCM are intentionally not included. The notification bell is an informational placeholder; a notification center is not implemented.
- Future Product Manager, Order Manager, Inventory Manager and Customer Support roles are listed as roadmap only; until permission-specific RLS is implemented, only `admin`/`super_admin` claims can enter.
- This build does not change the storefront SEO code. The live code review found existing sitemap/robots routes, general metadata, structured product data, and server-side Supabase product retrieval; canonical/product-specific metadata and the requested cache-revalidation work require a separately approved storefront patch. No indexing or Google Search Console result is claimed.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```
