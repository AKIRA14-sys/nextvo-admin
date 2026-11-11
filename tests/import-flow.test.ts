import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import ts from "typescript";

type History = {
  id: string;
  source_url: string;
  supplier_host: string;
  status: string;
  imported_title: string;
  error_summary: string;
  created_at: string;
};
type RouteDependencies = {
  user: { id: string; app_metadata?: Record<string, unknown> } | null;
  authorized?: boolean;
  restricted?: boolean;
  allowed?: unknown;
  rpcError?: unknown;
  fetchError?: Error;
  finalUrl?: string;
  historyError?: unknown;
  eventOrder?: string[];
  fetchCalls?: number;
  rpcCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  historyInput?: Record<string, unknown>;
};

const root = process.cwd();
const productSource = '<html><head><meta property="og:title" content="Mock product"></head><body></body></html>';
const confirmedHistory: History = {
  id: "history-1",
  source_url: "https://supplier.example/item",
  supplier_host: "supplier.example",
  status: "retrieved",
  imported_title: "Mock product",
  error_summary: "",
  created_at: "2026-01-02T03:04:05.000Z",
};

function loadRoute(path: string, deps: RouteDependencies) {
  const filename = join(root, path);
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: deps.user } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      deps.rpcCalls?.push({ name, args });
      return { data: Object.hasOwn(deps, "allowed") ? deps.allowed : true, error: deps.rpcError ?? null };
    },
    from: (table: string) => ({
      insert: (input: Record<string, unknown>) => {
        assert.equal(table, "nextvo_import_history");
        deps.historyInput = input;
        return {
          select: () => ({
            single: async () => {
              deps.eventOrder?.push("history");
              return deps.historyError ? { data: null, error: deps.historyError } : { data: { ...confirmedHistory, ...input }, error: null };
            },
          }),
        };
      },
    }),
  };
  const mocks: Record<string, unknown> = {
    "@/lib/server/safe-remote-fetch": {
      fetchPublicResource: async () => {
        deps.fetchCalls = (deps.fetchCalls ?? 0) + 1;
        deps.eventOrder?.push("fetch");
        if (deps.fetchError) throw deps.fetchError;
        return { body: new TextEncoder().encode(productSource), contentType: "text/html; charset=utf-8", url: new URL(deps.finalUrl || "https://supplier.example/item") };
      },
    },
    "@/lib/server/product-extractors": {
      looksLikeSupplierRestriction: () => deps.restricted ?? false,
      extractSupplierProduct: () => ({ title: "Mock product", description: "Description", images: [], price: "", currency: "", sku: "", brand: "", source_url: "https://supplier.example/item", supplier_host: "supplier.example" }),
      hasPublicProductMetadata: () => true,
    },
    "@/lib/server/import-diagnostics": {
      ImportDiagnosticError: class ImportDiagnosticError extends Error {
        code: string;
        constructor(code: string, cause?: unknown) { super(code, { cause }); this.code = code; }
      },
      logImportFailure: () => undefined,
      publicImportDiagnostic: (error: unknown, requestId: string) => ({ code: (error as { code?: string })?.code || "retrieval_failure", message: "Public metadata could not be retrieved.", request_id: requestId }),
      sanitizedSupplierHost: (url: URL) => url.hostname.toLowerCase(),
    },
    "@/lib/supabase/config": { isAuthorizedAdmin: () => deps.authorized ?? true },
    "@/lib/supabase/server": { getSupabaseServerClient: async () => supabase },
    "@/lib/image-validation": { validateProductImage: () => "image/png" },
  };
  const module = { exports: {} as Record<string, unknown> };
  const localRequire = (id: string) => mocks[id] ?? require(id);
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports as { POST: (request: NextRequest) => Promise<Response> };
}

function request(path = "/api/import") {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://supplier.example/item" }),
  });
}

function adminDeps(overrides: Partial<RouteDependencies> = {}): RouteDependencies {
  return { user: { id: "admin-1" }, eventOrder: [], rpcCalls: [], ...overrides };
}

test("metadata route authorizes before calling limiter or fetching", async () => {
  for (const deps of [adminDeps({ user: null }), adminDeps({ authorized: false })]) {
    const { POST } = loadRoute("src/app/api/import/route.ts", deps);
    const response = await POST(request());
    assert.equal(response.status, 403);
    assert.equal(deps.rpcCalls?.length ?? 0, 0);
    assert.equal(deps.fetchCalls ?? 0, 0);
  }
});

test("metadata route uses the fixed 60-second/10-request RPC limit and fails closed", async () => {
  for (const overrides of [{ allowed: false }, { allowed: null }, { rpcError: new Error("RPC unavailable") }]) {
    const deps = adminDeps(overrides);
    const { POST } = loadRoute("src/app/api/import/route.ts", deps);
    const response = await POST(request());
    assert.ok([429, 503].includes(response.status));
    assert.deepEqual(deps.rpcCalls, [{ name: "nextvo_consume_import_rate_limit", args: { p_window_seconds: 60, p_max_requests: 10 } }]);
    assert.equal(deps.fetchCalls ?? 0, 0);
  }
});

test("metadata route awaits history persistence and returns the confirmed history row", async () => {
  const deps = adminDeps();
  const { POST } = loadRoute("src/app/api/import/route.ts", deps);
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(deps.eventOrder, ["fetch", "history"]);
  assert.equal(body.history.id, "history-1");
  assert.equal(body.history.status, "retrieved");
  assert.equal(body.history_id, "history-1");
  assert.equal(body.title, "Mock product");
  assert.equal(deps.historyInput?.created_by, "admin-1");
});

test("metadata route records the final supplier URL and host after a public redirect", async () => {
  const finalUrl = "https://www.temu.com/goods.html?goods_id=123";
  const deps = adminDeps({ finalUrl });
  const { POST } = loadRoute("src/app/api/import/route.ts", deps);
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(deps.historyInput?.source_url, finalUrl);
  assert.equal(deps.historyInput?.supplier_host, "www.temu.com");
  assert.equal(body.history.source_url, finalUrl);
});

test("metadata route keeps the resolved URL in failed history when the final page is restricted", async () => {
  const finalUrl = "https://www.temu.com/goods.html?goods_id=123";
  const deps = adminDeps({ finalUrl, restricted: true });
  const { POST } = loadRoute("src/app/api/import/route.ts", deps);
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(deps.historyInput?.source_url, finalUrl);
  assert.equal(deps.historyInput?.supplier_host, "www.temu.com");
  assert.equal(body.history.status, "failed");
});

test("metadata route records failed retrieval with a safe diagnostic", async () => {
  const deps = adminDeps({ fetchError: new Error("secret internal transport details") });
  const { POST } = loadRoute("src/app/api/import/route.ts", deps);
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(deps.eventOrder?.[1], "history");
  assert.equal(deps.historyInput?.status, "failed");
  assert.equal(deps.historyInput?.imported_title, "");
  assert.equal(body.history.id, "history-1");
  assert.match(body.error, /could not be retrieved/i);
  assert.doesNotMatch(body.error, /secret internal/);
});

test("metadata route warns explicitly when history cannot be written instead of confirming it", async () => {
  const deps = adminDeps({ historyError: new Error("insert denied") });
  const { POST } = loadRoute("src/app/api/import/route.ts", deps);
  const response = await POST(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.history, null);
  assert.equal(body.history_id, null);
  assert.match(body.history_warning, /could not be saved to import history/i);
  assert.doesNotMatch(JSON.stringify(body), /history-1/);
});

test("image route authorizes before limiter or remote retrieval", async () => {
  const deps = adminDeps({ user: null });
  const { POST } = loadRoute("src/app/api/import/image/route.ts", deps);
  const response = await POST(new NextRequest("http://localhost/api/import/image", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://supplier.example/image.png", rightsConfirmed: true }),
  }));
  assert.equal(response.status, 403);
  assert.equal(deps.rpcCalls?.length ?? 0, 0);
  assert.equal(deps.fetchCalls ?? 0, 0);
});

test("image route applies the fixed limiter and fails closed before remote retrieval", async () => {
  const deps = adminDeps({ rpcError: new Error("unavailable") });
  const { POST } = loadRoute("src/app/api/import/image/route.ts", deps);
  const response = await POST(new NextRequest("http://localhost/api/import/image", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://supplier.example/image.png", rightsConfirmed: true }),
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(deps.rpcCalls, [{ name: "nextvo_consume_import_rate_limit", args: { p_window_seconds: 60, p_max_requests: 10 } }]);
  assert.equal(deps.fetchCalls ?? 0, 0);
});
