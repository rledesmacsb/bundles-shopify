const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.resolve(__dirname, "../app/lib/bundle-deletion.server.ts");
const source = fs.readFileSync(file, "utf8");
const { outputText, diagnostics } = ts.transpileModule(source, {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((diagnostics || []).filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
const moduleRef = { exports: {} };
vm.runInNewContext(outputText, { exports: moduleRef.exports, module: moduleRef, console }, {
  filename: "bundle-deletion.server.cjs",
});
const { protectBundlesAfterProductDeletion } = moduleRef.exports;

const deleted = "gid://shopify/Product/50011";
const replacement = "gid://shopify/Product/50012";
function bundle(id, status, sourceId, managed = true) {
  return {
    id: `gid://shopify/Product/${id}`,
    title: `Test Bundle ${id}`,
    status,
    managed: { value: managed ? "csbyte-commerce-tools" : "another-app" },
    snapshot: { value: JSON.stringify({
      base: { productId: sourceId },
      monitor: { productId: "gid://shopify/Product/50022" },
      keyboardMouse: { productId: "gid://shopify/Product/50033" },
      wifiAdapter: null,
    }) },
  };
}
function fakeAdmin(items, opts = {}) {
  let writes = [];
  const all = new Map(items.map(x => [x.id, x]));
  const admin = { graphql: async (operation, { variables } = {}) => {
    let data;
    if (operation.includes("CsbyteProductsDeleteBundleList")) {
      data = { products: { nodes: [...all.values()], pageInfo: {
        hasNextPage: false, endCursor: null,
      } } };
    } else if (operation.includes("CsbyteRecheckDeletedBundle")) {
      if (opts.beforeRecheck) opts.beforeRecheck(all);
      data = { product: all.get(variables.id) ?? null };
    } else if (operation.includes("CsbyteDraftDeletedComponentBundle")) {
      const item = all.get(variables.product.id);
      writes.push({ ...variables.product });
      item.status = "DRAFT";
      data = { productUpdate: { product: { id: item.id, status: item.status }, userErrors: [] } };
    } else {
      throw new Error("Unexpected GraphQL operation: " + operation.slice(0, 80));
    }
    return { json: async () => ({ data }) };
  } };
  return { admin, writes, all };
}

test("deleted component disables only active CSBYTE Bundle", async () => {
  const fixture = fakeAdmin([
    bundle(80001, "ACTIVE", deleted),
    bundle(80002, "DRAFT", deleted),
    bundle(80003, "ACTIVE", replacement),
    bundle(80004, "ACTIVE", deleted, false),
  ]);
  const result = await protectBundlesAfterProductDeletion(fixture.admin, deleted);
  assert.equal(result.unpublished, 1);
  assert.equal(result.matched, 1);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.writes[0].id, "gid://shopify/Product/80001");
  assert.equal(fixture.all.get("gid://shopify/Product/80001").status, "DRAFT");
  assert.equal(fixture.all.get("gid://shopify/Product/80003").status, "ACTIVE");
  assert.equal(fixture.all.get("gid://shopify/Product/80004").status, "ACTIVE");
});

test("retry does not duplicate productUpdate", async () => {
  const fixture = fakeAdmin([bundle(80001, "ACTIVE", deleted)]);
  await protectBundlesAfterProductDeletion(fixture.admin, deleted);
  const again = await protectBundlesAfterProductDeletion(fixture.admin, deleted);
  assert.equal(again.unpublished, 0);
  assert.equal(fixture.writes.length, 1);
});

test("same SKU of a replacement does not cause ID substitution", async () => {
  const fixture = fakeAdmin([bundle(80001, "ACTIVE", replacement)]);
  const result = await protectBundlesAfterProductDeletion(fixture.admin, deleted);
  assert.equal(result.unpublished, 0);
  assert.equal(fixture.writes.length, 0);
});

test("a repaired bundle is re-read before disabling", async () => {
  let repaired = false;
  const fixture = fakeAdmin([bundle(80001, "ACTIVE", deleted)], {
    beforeRecheck: (all) => {
      if (!repaired) {
        all.get("gid://shopify/Product/80001").snapshot = {
          value: JSON.stringify({ base: { productId: replacement } }),
        };
        repaired = true;
      }
    },
  });
  const result = await protectBundlesAfterProductDeletion(fixture.admin, deleted);
  assert.equal(result.skipped, 1);
  assert.equal(fixture.writes.length, 0);
});

test("invalid event product ID is rejected before GraphQL", async () => {
  const fixture = fakeAdmin([bundle(80001, "ACTIVE", deleted)]);
  await assert.rejects(
    protectBundlesAfterProductDeletion(fixture.admin, "PTR-HPR50308256-C-001"),
    /ID válido/,
  );
  assert.equal(fixture.writes.length, 0);
});