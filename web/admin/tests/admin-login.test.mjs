import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

for (const extension of [".ts", ".tsx"]) {
  Module._extensions[extension] = (module, filename) => {
    const source = readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    });
    module._compile(compiled.outputText, filename);
  };
}

test("login defaults to account credentials with an API key fallback", () => {
  const Login = require(resolve(projectDir, "src/pages/Login.tsx")).default;
  const html = renderToStaticMarkup(createElement(Login, { onLogin() {} }));

  assert.match(html, /邮箱/);
  assert.match(html, /密码/);
  assert.match(html, /使用 API 密钥/);
});

test("admin authentication credentials remain in memory and cookie writes carry CSRF", () => {
  const api = readFileSync(resolve(projectDir, "src/api.ts"), "utf8");

  assert.doesNotMatch(api, /sessionStorage/);
  assert.doesNotMatch(api, /localStorage/);
  assert.match(api, /credentials:\s*["']same-origin["']/);
  assert.match(api, /headers\.set\(["']X-Admin-CSRF["']/);
});

test("a failed account logout preserves CSRF authentication for a retry", async () => {
  const api = require(resolve(projectDir, "src/api.ts"));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    if (path === "/admin/auth/login") {
      return new Response(JSON.stringify({
        id: "admin-1",
        email: "admin@example.test",
        name: "Admin",
        csrf_token: "csrf-for-retry",
        expires_at: "2030-01-01T00:00:00Z",
      }), { status: 200 });
    }
    if (path === "/admin/auth/logout") {
      return new Response(JSON.stringify({ detail: "server unavailable" }), { status: 500 });
    }
    return new Response(null, { status: 204 });
  };

  try {
    await api.loginWithPassword("admin@example.test", "correct-password");
    await assert.rejects(api.logout(), { message: "server unavailable" });
    await api.createUser({ email: "new@example.test", name: "New", password: "strong-password", role: "admin" });

    const retryRequest = requests.at(-1);
    assert.equal(new Headers(retryRequest.options.headers).get("X-Admin-CSRF"), "csrf-for-retry");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
