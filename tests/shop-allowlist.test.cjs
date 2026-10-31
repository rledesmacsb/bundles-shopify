const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.resolve(__dirname, "../app/lib/shop-allowlist.server.ts");
const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
function load(value) {
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, process: { env: { CSBYTE_ALLOWED_SHOPS: value } }, Set,
  });
  return exports;
}

test("missing allowlist blocks every shop", () => {
  const guard = load(undefined);
  assert.equal(guard.isAllowedShop("csbyte-bundle-dev.myshopify.com"), false);
});
test("exact allowlist permits development shop only", () => {
  const guard = load("csbyte-bundle-dev.myshopify.com");
  assert.equal(guard.isAllowedShop("csbyte-bundle-dev.myshopify.com"), true);
  assert.equal(guard.isAllowedShop("csbyte.myshopify.com"), false);
  assert.equal(guard.isAllowedShop("some-other.myshopify.com"), false);
});
test("reject wildcard and invalid domain", () => {
  const guard = load("*.myshopify.com,csbyte.cl,csbyte-bundle-dev.myshopify.com");
  assert.equal(guard.allowedShopDomains().size, 1);
});
