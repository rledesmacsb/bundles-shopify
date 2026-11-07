const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.resolve(__dirname, "../app/lib/bundle-deletion.server.ts");
const source = fs.readFileSync(file, "utf8");
const { outputText, diagnostics } = ts.transpileModule(source, {
  fileName: file, reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const moduleRef = { exports: {} };
vm.runInNewContext(outputText, { exports: moduleRef.exports, module: moduleRef, console }, {
  filename: "bundle-inventory.server.cjs",
});
const { protectBundlesAfterInventoryChange } = moduleRef.exports;

const changedInventoryItem = "gid://shopify/InventoryItem/7010";
const changedProduct = "gid://shopify/Product/5010";
const changedVariant = "gid://shopify/ProductVariant/6010";

function fixture(opts = {}) {
  const items = [
    { id: changedProduct, variantId: changedVariant, stock: opts.stock ?? 0 },
    { id: "gid://shopify/Product/5020", variantId: "gid://shopify/ProductVariant/6020", stock: 10 },
    { id: "gid://shopify/Product/5030", variantId: "gid://shopify/ProductVariant/6030", stock: 12 },
  ];
  const snapshot = { schemaVersion: 2, sku: "BND-PC-TEST", finalPrice: 100000,
    base: {productId: items[0].id, variantId: items[0].variantId},
    monitor: {productId: items[1].id, variantId: items[1].variantId},
    keyboardMouse: {productId: items[2].id, variantId: items[2].variantId},
    wifiAdapter: null,
  };
  const b = {
    id: "gid://shopify/Product/9000",
    title: "Bundle protegido",
    status: opts.status || "ACTIVE",
    managed: {value: opts.managed === false ? "third-party" : "csbyte-commerce-tools"},
    snapshot: {value: JSON.stringify(snapshot)},
    bundleComponents: {
      nodes: items.map(i => ({
        quantity: 1,
        componentProduct: {id:i.id,status:"ACTIVE",totalInventory:i.stock},
        componentVariants: {nodes:[{id:i.variantId,inventoryQuantity:i.stock}],
          pageInfo: {hasNextPage:false}},
      })),
      pageInfo:{hasNextPage:false},
    },
  };
  const writes = [];
  const admin = { graphql: async (operation, {variables} = {}) => {
    let data;
    if (operation.includes("CsbyteInventoryEventSource")) {
      data = {inventoryItem: {
        id: changedInventoryItem,
        variants: {nodes:[{id:opts.eventVariant || changedVariant,
          product:{id:opts.eventProduct || changedProduct}}],
          pageInfo:{hasNextPage:false}},
      }};
    } else if (operation.includes("CsbyteProductsDeleteBundleList")) {
      data = {products:{nodes:[b],pageInfo:{hasNextPage:false,endCursor:null}}};
    } else if (operation.includes("CsbyteInventoryRecheckManagedBundle")) {
      if (opts.restoreOnRecheck) {
        b.bundleComponents.nodes[0].componentProduct.totalInventory = 8;
        b.bundleComponents.nodes[0].componentVariants.nodes[0].inventoryQuantity = 8;
      }
      data = {product:b};
    } else if (operation.includes("CsbyteInventoryProtectBundle")) {
      writes.push(variables.product);
      b.status = "DRAFT";
      data = {productUpdate:{product:{id:b.id,status:b.status},userErrors:[]}};
    } else {
      throw new Error("Unexpected GraphQL operation " + operation.slice(0,80));
    }
    return {json:async()=>({data})};
  }};
  return {admin,b,writes,run:()=>protectBundlesAfterInventoryChange(admin,changedInventoryItem)};
}

test("zero-stock component puts active managed Bundle in draft", async () => {
  const f=fixture();
  const result=await f.run();
  assert.equal(result.unpublished,1);
  assert.equal(result.errors.length,0);
  assert.equal(f.b.status,"DRAFT");
  assert.equal(f.writes.length,1);
});

test("recovered inventory does not unpublish", async () => {
  const f=fixture({restoreOnRecheck:true});
  const result=await f.run();
  assert.equal(result.unpublished,0);
  assert.equal(result.errors.length,0);
  assert.equal(f.b.status,"ACTIVE");
});

test("replayed inventory event is idempotent", async () => {
  const f=fixture();
  await f.run();
  const second=await f.run();
  assert.equal(second.unpublished,0);
  assert.equal(f.writes.length,1);
});

test("unrelated inventory variant never disables another Bundle", async () => {
  const f=fixture({eventVariant:"gid://shopify/ProductVariant/77777"});
  const result=await f.run();
  assert.equal(result.unpublished,0);
  assert.equal(f.writes.length,0);
});

test("foreign-app Bundle is not modified", async () => {
  const f=fixture({managed:false});
  const result=await f.run();
  assert.equal(result.unpublished,0);
  assert.equal(f.writes.length,0);
});

test("missing inventory item identifier fails before GraphQL", async () => {
  const f=fixture();
  await assert.rejects(
    protectBundlesAfterInventoryChange(f.admin,"invalid-id"),
    /ID válido/,
  );
  assert.equal(f.writes.length,0);
});
