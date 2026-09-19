import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

test("admin UI starts in Simplified Chinese and translates navigation", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  globalThis.document = { documentElement: { lang: "en" }, title: "Authplane Admin" };

  let localization;
  try {
    localization = require(resolve(projectDir, "src/i18n.ts"));
  } catch {
    localization = null;
  }

  assert.ok(localization?.i18n, "the admin localization runtime must exist");
  assert.equal(localization.i18n.language, "zh-CN");
  assert.equal(localization.i18n.t("common:nav.users"), "用户");
  assert.equal(document.documentElement.lang, "zh-CN");
  assert.equal(document.title, "Authplane 管理后台");
});

test("explicit English choice updates translations and persists", async () => {
  const { i18n, setLanguage } = require(resolve(projectDir, "src/i18n.ts"));

  await setLanguage("en");

  assert.equal(i18n.t("common:nav.users"), "Users");
  assert.equal(localStorage.getItem("authplane_language"), "en");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(document.title, "Authplane Admin");
});

test("admin page namespaces resolve in both languages", async () => {
  const { i18n, setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  assert.equal(i18n.t("login:signIn"), "登录");
  await setLanguage("en");
  assert.equal(i18n.t("login:signIn"), "Sign In");
});

test("language switch control offers the other language on both login and sidebar", async () => {
  let Switcher;
  try {
    Switcher = require(resolve(projectDir, "src/components/LanguageSwitcher.tsx")).default;
  } catch {
    Switcher = null;
  }
  assert.ok(Switcher, "the language switch control must exist");

  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const chinese = renderToStaticMarkup(createElement(Switcher));
  assert.match(chinese, /English/);
  assert.match(chinese, /语言/);

  await setLanguage("en");
  const english = renderToStaticMarkup(createElement(Switcher));
  assert.match(english, /简体中文/);
  assert.match(english, /Language/);
});

test("admin shell shows Chinese while checking the login session", async () => {
  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const App = require(resolve(projectDir, "src/App.tsx")).default;
  const html = renderToStaticMarkup(createElement(App));

  assert.match(html, /正在检查登录状态/);
  assert.match(html, /语言/);
});

test("fronting page renders Chinese actions and empty state by default", async () => {
  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const Fronting = require(resolve(projectDir, "src/pages/Fronting.tsx")).default;
  const html = renderToStaticMarkup(createElement(Fronting));

  assert.match(html, /资源代理/);
  assert.match(html, /新建代理关系/);
  assert.match(html, /尚无代理关系/);
});

test("shared admin controls show Chinese search and scope mapping guidance", async () => {
  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const Table = require(resolve(projectDir, "src/components/Table.tsx")).default;
  const ScopeMapEditor = require(resolve(projectDir, "src/components/ScopeMapEditor.tsx")).default;
  const table = renderToStaticMarkup(createElement(Table, { headers: [], rows: [], searchable: true }));
  const editor = renderToStaticMarkup(createElement(ScopeMapEditor, {
    sourceScopes: [], targetScopes: [], value: {}, onChange() {},
  }));

  assert.match(table, /搜索/);
  assert.match(editor, /选择源资源和目标资源/);
});

test("resource fronting section shows Chinese loading state", async () => {
  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const Section = require(resolve(projectDir, "src/components/ResourceFrontingSection.tsx")).default;
  const html = renderToStaticMarkup(createElement(Section, {
    slug: "sample", kind: "mint", scopes: [], onCreateLink() {}, onEditLink() {},
  }));

  assert.match(html, /正在加载代理关系/);
});

test("fronting link drawer renders Chinese field labels and actions", async () => {
  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const Drawer = require(resolve(projectDir, "src/components/FrontingLinkDrawer.tsx")).default;
  const html = renderToStaticMarkup(createElement(Drawer, {
    mode: "create", resources: [], onClose() {}, onSaved() {},
  }));

  assert.match(html, /新建代理关系/);
  assert.match(html, /源资源/);
  assert.match(html, /验证/);
  assert.match(html, /保存/);
});

test("empty fronting graph explains the next step in Chinese", async () => {
  const { setLanguage } = require(resolve(projectDir, "src/i18n.ts"));
  await setLanguage("zh-CN");
  const Graph = require(resolve(projectDir, "src/components/FrontingGraph.tsx")).default;
  const html = renderToStaticMarkup(createElement(Graph, {
    links: [], resources: [], onNodeClick() {}, onEdgeClick() {},
  }));

  assert.match(html, /尚无代理关系/);
  assert.match(html, /列表/);
});
