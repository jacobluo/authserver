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

const { i18n } = require(resolve(projectDir, "src/i18n.ts"));
await i18n.changeLanguage("zh-CN");

test("System page renders its heading and configuration summary in Simplified Chinese", () => {
  const System = require(resolve(projectDir, "src/pages/System.tsx")).default;
  const html = renderToStaticMarkup(createElement(System));
  assert.match(html, /系统/);
  assert.match(html, /服务器健康状态和配置/);
  assert.doesNotMatch(html, />System</);
});

for (const [page, heading] of [
  ["SigningKeys", "签名密钥"],
  ["Tokens", "令牌"],
  ["Providers", "提供方"],
  ["Resources", "资源"],
  ["Grants", "授权"],
  ["Issuances", "签发记录"],
]) {
  test(`${page} page renders its heading in Simplified Chinese`, () => {
    const Page = require(resolve(projectDir, `src/pages/${page}.tsx`)).default;
    const html = renderToStaticMarkup(createElement(Page));
    assert.match(html, new RegExp(heading));
  });
}

test("Inspector tab explains local JWT decoding in Simplified Chinese", () => {
  const Inspector = require(resolve(projectDir, "src/pages/tokens/InspectorTab.tsx")).default;
  const html = renderToStaticMarkup(createElement(Inspector));
  assert.match(html, /本地解码/);
});

test("Issued tab presents its search prompt in Simplified Chinese", () => {
  const Issued = require(resolve(projectDir, "src/pages/tokens/IssuedTab.tsx")).default;
  const html = renderToStaticMarkup(createElement(Issued));
  assert.match(html, /按 JTI、客户端、用户或权限范围搜索/);
});

test("shared consent revoke copy is localized for callers outside Grants page", () => {
  const { consentRevokeCopy } = require(resolve(projectDir, "src/pages/Grants.tsx"));
  const copy = consentRevokeCopy(
    { id: "grant-1", user_id: "user-1", client_id: "client-1", resource_id: "resource-1", scopes: ["read"], created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    [{ id: "client-1", name: "Example client", redirect_uris: [], grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none", status: "active", registration_source: "admin", cimd_url: "", issued_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    [{ id: "resource-1", slug: "example-resource", uri: "https://example.test/mcp", backend_kind: "mint", broker_provider_id: "", display_name: "Example resource", scopes: [{ name: "read", description: "Read", upstream: "" }], policy: { exchange: { allowed_client_ids: ["client-1"] }, runtime: { client_ids: [] } }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
  );
  assert.match(copy, /撤销 Example client 对 example-resource 的访问同意/);
});
