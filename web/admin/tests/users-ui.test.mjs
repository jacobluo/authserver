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

test("users page offers an action to create a user", () => {
  const Users = require(resolve(projectDir, "src/pages/Users.tsx")).default;
  const html = renderToStaticMarkup(createElement(Users));
  assert.match(html, /<button\b[^>]*>创建用户<\/button>/);
});
