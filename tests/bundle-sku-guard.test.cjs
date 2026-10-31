const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.resolve(__dirname, "../app/lib/bundle-sku-guard.server.ts");
const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
const moduleRef = { exports: {} };
vm.runInNewContext(outputText, { exports: moduleRef.exports, module: moduleRef, console });
const { auditComponentSkuUniqueness } = moduleRef.exports;

const component = {
  productId: "gid://shopify/Product/1001",
  variantId: "gid://shopify/ProductVariant/2001",
  sku: "TEST-COMP-001",
  label: "PC",
};
function variant(id, productId, sku = component.sku) {
  return { id: `gid://shopify/ProductVariant/${id}`, sku,
    product: { id: `gid://shopify/Product/${productId}` } };
}
function adminWith(variants, hasNextPage = false) {
  return { graphql: async (query, { variables } = {}) => {
    const data = Object.fromEntries(Object.entries(variables).map(([key], i) => [
      `v${i}`, { nodes: variants, pageInfo: { hasNextPage } },
    ]));
    return { json: async () => ({ data }) };
  } };
}

test("SKU with one exact matching variant passes", async () => {
  const issues = await auditComponentSkuUniqueness(
    adminWith([variant(2001, 1001)]), [component],
  );
  assert.equal(issues.length, 0);
});
test("SKU present on two products is blocked", async () => {
  const issues = await auditComponentSkuUniqueness(
    adminWith([variant(2001, 1001), variant(3001, 1002)]), [component],
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "duplicate");
});
test("same SKU on two variants of one product is blocked", async () => {
  const issues = await auditComponentSkuUniqueness(
    adminWith([variant(2001, 1001), variant(2002, 1001)]), [component],
  );
  assert.equal(issues[0].code, "duplicate");
});
test("same SKU on a different product fails by immutable GID", async () => {
  const issues = await auditComponentSkuUniqueness(
    adminWith([variant(3001, 1002)]), [component],
  );
  assert.equal(issues[0].code, "missing");
});
test("unbounded SKU search fails closed", async () => {
  const issues = await auditComponentSkuUniqueness(
    adminWith([variant(2001, 1001)], true), [component],
  );
  assert.equal(issues[0].code, "ambiguous");
});
test("empty SKU fails before mutation", async () => {
  const issues = await auditComponentSkuUniqueness(
    adminWith([]), [{ ...component, sku: "" }],
  );
  assert.equal(issues[0].code, "invalid");
});
test("network failure blocks publication and creation", async () => {
  const issues = await auditComponentSkuUniqueness(
    { graphql: async () => { throw new Error("Shopify timeout"); } }, [component],
  );
  assert.equal(issues[0].code, "lookup_failed");
});