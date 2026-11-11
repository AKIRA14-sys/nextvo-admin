# NEXTVO Admin

A standalone, mobile-first, installable PWA for managing the NEXTVO catalogue. It is a separate Next.js application and repository, connected to the existing storefront Supabase project. It does not create a second catalogue or seed demo data.

## What the Admin does

The app includes protected catalogue editing, publication controls, category management, product variants, stock adjustments, image upload/reordering, public-page metadata import, customer and order views, an Admin-only verified-payment ledger, estimated-profit tools and private Admin settings. It does not create fictional products, customers, orders, payments, sales or analytics.

Admin authorization is checked server-side and in Row Level Security using trusted Supabase Auth `app_metadata` claims (`role: "admin"` or `role: "super_admin"`, with the existing legacy equivalents retained). It never uses user-editable `user_metadata` as an authorization boundary. The browser uses only the project's publishable/anon key; no service-role key is used or required.

## Product editing and prices

The product editor has separate actions: **Save draft** always writes `draft`, **Publish** explicitly writes `published`, and **Save changes** preserves the selected current status. Product prices, compare-at prices and variant prices are stored as NGN. Supplier costs and their original three-letter currency code are stored only in the Admin-only details table. The importer leaves the NGN selling price blank; no currency conversion is performed.

The Admin checks for duplicate slugs before saving. The storefront's existing schema migration declares `products.slug` unique, which is the final database guard for normal exact-slug collisions. The current storefront does not keep old slugs as redirects, so changing an already-shared product slug can still break the old link; a storefront-side slug-history/redirect change remains separate and unapproved.

## Importer and images

Import supports public page metadata and Product JSON-LD when available; it is not compatible with every supplier site. Extracted price/currency stays separate from the NGN selling price, and the administrator must review the result before saving or explicitly publishing. Shipping, variants, supplier options and stock are not treated as verified extraction.

The Admin importer:

- accepts small JSON requests and limits a page response to 1.5 MB;
- permits public HTTPS URLs only, rejects local/private/special-use DNS answers, pins the validated address, revalidates redirects, limits redirects and applies an overall timeout;
- uses a database-backed limit of 10 metadata/image requests per administrator per minute, enforced by the `nextvo_consume_import_rate_limit` RPC;
- never bypasses CAPTCHA, authentication, paywalls, anti-bot controls or source restrictions.

The database-backed limiter is fail-closed: the Admin SQL setup must be reviewed and applied before either importer endpoint will run. The image-copy action is never automatic. It requires the administrator to confirm reuse rights and source terms, fetches only supported image bytes from a public HTTPS URL, limits the image to 5 MB, checks its actual JPEG/PNG/WebP/AVIF signature, hashes the bytes to reuse duplicates, and stores it in the existing `product-images` Supabase Storage bucket. If copying is not permitted, deselect the image and use an image the business is allowed to publish. The product editor also provides manual uploads and visibly flags any externally hosted image URL; those URLs may stop working if the source changes.

The reviewed storefront migration configures the existing `product-images` bucket as public-read with a 5 MB limit and JPEG/PNG/WebP/AVIF MIME types. The Admin SQL adds narrowly scoped Storage insert/delete policies for authenticated users whose trusted `app_metadata` marks them as an Admin. Delete is needed only for the editor's temporary-upload cleanup after a failed catalogue save; there is no overwrite policy, and public/customer writes remain unavailable. Copied-image original URLs are retained only in the RLS-protected Admin details table, never in the public catalogue. Verify the actual production bucket, size/MIME settings and all existing Storage policies before applying the SQL.

## Review before applying Supabase SQL

`supabase/admin-setup.sql` is a setup script, **not evidence that any production database was changed**. It has not been run against the live Supabase project here. It creates Admin extension tables and functions, enables RLS, adjusts grants, adds missing Admin policies (including Admin-only Storage inserts/deletes), retains copied-image provenance privately, and adds the catalogue tables to Realtime when available. It contains no `DROP TABLE`, `TRUNCATE` or `DROP POLICY`; it adds policies only when that exact policy name is absent, leaving every existing policy definition intact. It still adjusts grants and must be compared with the live database before application.

The public storefront migrations were reviewed read-only for the catalogue fields, the `products.slug` unique constraint, public active-product/category reads, product-image bucket type/size settings and related catalogue tables. This is not a live schema inspection. Before applying the Admin SQL, compare every referenced table, column, constraint, grant, existing RLS policy and Storage policy with the actual Supabase project and take a backup or use a staging clone. PostgreSQL permissive policies are OR-combined: a pre-existing broad policy can remain effective even after this script adds a restrictive Admin policy. Test access as `anon`, an ordinary customer and an Admin before production use. No SQL or production migration was run in this task.

The SQL now also creates the private import-rate-limit table and `nextvo_consume_import_rate_limit` function, plus `nextvo_admin_set_product_status` for a transactionally consistent quick publish/unpublish. It adds private per-image source metadata to the Admin details table and an Admin-only insert policy for `product-images`. Review those additions together with the rest of the setup before applying.

### Assigning the first administrator

The administrator must already exist in Supabase Auth. In Supabase Dashboard → Authentication → Users, select that account and assign trusted **app metadata**:

```json
{"role":"super_admin"}
```

Alternatively, after verifying the exact existing Auth UUID, run this account-specific statement in the Supabase SQL Editor:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"super_admin"}'::jsonb
where id = 'THE_EXISTING_ADMIN_AUTH_USER_UUID';
```

Do not put this role in `user_metadata`, a profile field, client code or local storage. Sign out and back in to refresh the JWT claim. No credentials or live role changes were made here.

## Vercel and Node configuration

Create a **separate Vercel project** for `AKIRA14-sys/nextvo-admin`, with the repository root as the project root. Set these variables on that Admin Vercel project:

| Variable | Required | Value or purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Existing project URL: `https://eagalzikryikfibqcpsr.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes, preferred | Existing project's publishable key. If only the legacy anon key is available, use the alternative below instead. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Alternative | Legacy anon key only when the project does not provide a publishable key; do not set both unless intentionally configured. |
| `NEXT_PUBLIC_STOREFRONT_URL` | Yes for share links | Real customer-facing storefront origin, with no trailing slash. |
| `NEXT_PUBLIC_STORE_NAME` | Optional | Defaults to `NEXTVO`. |
| `NEXT_PUBLIC_STORE_CURRENCY` | Optional | Defaults to `NGN`; the product editor itself stores prices in NGN. |
| `NEXT_PUBLIC_SITE_URL` | Optional | Admin origin; current auth redirects use the active Admin origin. |

There are no private environment variables required by this Admin code. Do **not** add `SUPABASE_SERVICE_ROLE_KEY` here, in browser variables, GitHub or local storage. A future storefront on-demand revalidation route would need its own server-only secret in the storefront deployment; that change is not part of this Admin repository.

Use **Node.js 22.19.0 or later within the Node 22 line**. `package.json` declares `>=22.19.0 <23.0.0`; `.nvmrc` and GitHub Actions use 22.19.0. The locked `undici` dependency requires this minimum. Configure the Admin Vercel project's Node.js version to 22.x (22.19.0 or later).

## Storefront synchronization, SEO and URL limits

The Admin writes catalogue changes directly to the shared Supabase tables. The read-only review of the current storefront source found that its public product query filters on `products.active = true`, while the sitemap is dynamic. Its product/category data helpers use request-scoped React memoization and no explicit persistent Next.js data cache was found. That is consistent with changed data appearing on the next server request without a new Vercel deployment, but no live storefront request or deployed CDN/browser cache test was possible. Realtime alone is not relied on to invalidate a server-rendered cache.

The storefront source was not changed. Its existing SEO controls include a dynamic sitemap, an environment-gated `robots.ts`, and public Product JSON-LD. The reviewed product route currently lacks a product canonical URL, the category route lacks canonical metadata, and sitemap product dates use `created_at`; these need a separate storefront patch to add current canonicals/metadata and use `updated_at`. Keep public indexing disabled until the real production domain is configured and verified. The Admin PWA itself has `noindex`/`nofollow` metadata and authenticated responses are marked `private, no-store`.

The existing storefront does not use Admin settings. The Admin settings page now labels every stored value as Admin-only; they do not change customer-facing store availability, announcement, shipping, contact or currency behavior. Connecting those settings requires a separate secure storefront implementation that exposes only public-safe values.

The storefront has not completed live checkout/payment integration. Orders are existing records with fulfillment views, not proof of new customer transactions; payment status is not verified from client input. Payments/revenue remain read-only and empty until a separately authorized server-side payment-provider webhook verifies signatures, handles idempotency/refunds and writes the verified ledger. Fulfillment and order creation must also be connected to the future checkout flow.

## PWA and privacy

The manifest, app icons and offline fallback are included. The service worker caches only the offline page, icons and fingerprinted Next static assets; Admin pages, API responses, customer data and auth tokens are network-only. Offline mode does not claim to support private Admin operations. Cache cleanup is limited to cache names owned by this PWA, and an available PWA update can be applied through an explicit reload prompt.

Install from HTTPS Chrome on Android via **Install app** or **Add to Home screen**. The project has responsive mobile layouts, but installation, keyboard behavior and image upload have not been tested on a physical Android device in this environment.

## Automated checks

Run:

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

GitHub Actions runs these same checks on pushes and pull requests to `main`. Unit tests cover trusted-role checks, save-status behavior, USD/GBP/EUR/NGN price separation, preservation of existing product attributes, supported image signatures, DNS-pinned SSRF filters, unsafe redirects and response-size bounds; `node --check public/sw.js` checks the service-worker syntax. Live RLS, Storage, product-write, storefront-visibility and device-installation checks require the real Supabase configuration and an appropriate staging/deployment environment; they are not claimed as tested here.
