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
        esModuleInterop: true,
        resolveJsonModule: true,
      },
    });
    module._compile(compiled.outputText, filename);
  };
}

const { i18n } = require(resolve(projectDir, "src/i18n.ts"));
assert.equal(i18n.language, "zh-CN");

const user = { id: "user-1", email: "u@example.test", name: "Test", status: "active", role: "user", provider: "local", created_at: "2026-01-01T00:00:00Z" };

for (const [file, namespace, expected] of [
  ["Login", "login", ["管理控制台", "账户登录"]],
  ["Overview", "overview", ["概览", "签名密钥"]],
  ["Clients", "clients", ["客户端", "创建客户端"]],
  ["Users", "users", ["用户", "创建用户"]],
  ["AuditLog", "audit", ["审计日志", "刷新"]],
]) {
  test(`${file} renders translated Chinese interface text`, () => {
    const Page = require(resolve(projectDir, `src/pages/${file}.tsx`)).default;
    const html = renderToStaticMarkup(createElement(Page, file === "Login" ? { onLogin() {} } : {}));
    for (const text of expected) assert.ok(html.includes(text), `${namespace}: missing ${text}`);
  });
}

for (const [file, expected] of [
  ["UserGrantsSection", "授权"],
  ["UserIssuancesSection", "近期签发"],
]) {
  test(`${file} renders translated Chinese section heading`, () => {
    const Section = require(resolve(projectDir, `src/pages/users/${file}.tsx`)).default;
    const html = renderToStaticMarkup(createElement(Section, { user }));
    assert.ok(html.includes(expected), `missing ${expected}`);
  });
}
