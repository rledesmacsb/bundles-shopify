const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filepath = path.resolve(__dirname, "../app/lib/bundle-sku-guard.server.ts");
const source = fs.readFileSync(filepath, "utf8");
const output = ts.transpileModule(source, {
  fileName: filepath,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((output.diagnostics || []).filter(d=>d.category===ts.DiagnosticCategory.Error).length, 0);
const ref = { exports: {} };
vm.runInNewContext(output.outputText, { exports: ref.exports, module: ref, console, Map, Set, Object, String }, { filename: filepath });
const { auditComponentSkuUniqueness } = ref.exports;

const productId = "gid://shopify/Product/123";
const variantId = "gid://shopify/ProductVariant/456";
const candidate = { productId, variantId, sku: " QA-UNIQUE ", label: "PC temporal" };
const result = (id=variantId, owner=productId, sku="QA-UNIQUE")=>({
  id, sku, product: { id: owner, title: "PC temporal" },
});

function adminFor(nodes, opts={}) {
  const calls = [];
  const admin = {
    graphql: async (query, { variables } = {}) => {
      calls.push({ query, variables });
      if (opts.reject) throw Error("timeout");
      const data = {};
      Object.keys(variables || {}).forEach((_, i) => {
        data["v"+i] = opts.omit ? undefined : {
          nodes, pageInfo: { hasNextPage: Boolean(opts.next) },
        };
      });
      return { json: async()=>opts.errors ? {errors:[{message:"Shopify API error"}]} : {data} };
    },
  };
  return { admin, calls };
}

test("unique exact component variant SKU is accepted", async()=>{
  const f=adminFor([result()]);
  const issues=await auditComponentSkuUniqueness(f.admin,[candidate]);
  assert.equal(issues.length,0);
  assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].variables.q0,'sku:"QA-UNIQUE"');
});

test("duplicate SKU variants are blocked even with selected exact GID", async()=>{
  const f=adminFor([result(),result("gid://shopify/ProductVariant/999","gid://shopify/Product/888")]);
  const issues=await auditComponentSkuUniqueness(f.admin,[candidate]);
  assert.equal(issues.length,1);
  assert.equal(issues[0].code,"duplicate");
});

test("same SKU on different GID does not replace original component", async()=>{
  const f=adminFor([result("gid://shopify/ProductVariant/999","gid://shopify/Product/888")]);
  const issues=await auditComponentSkuUniqueness(f.admin,[candidate]);
  assert.equal(issues.length,1);
  assert.equal(issues[0].code,"missing");
});

test("unbounded SKU lookup blocks creation safely", async()=>{
  const f=adminFor([result()],{next:true});
  const issues=await auditComponentSkuUniqueness(f.admin,[candidate]);
  assert.equal(issues[0].code,"ambiguous");
});

test("Shopify lookup failure blocks rather than assuming uniqueness", async()=>{
  const f=adminFor([],{reject:true});
  const issues=await auditComponentSkuUniqueness(f.admin,[candidate]);
  assert.equal(issues[0].code,"lookup_failed");
});

test("missing or malformed component IDs are rejected before API access", async()=>{
  const f=adminFor([]);
  const issues=await auditComponentSkuUniqueness(f.admin,[
    {...candidate,sku:""},
    {...candidate,productId:"wrong"},
  ]);
  assert.equal(issues.length,2);
  assert.equal(issues[0].code,"invalid");
  assert.equal(issues[1].code,"invalid");
  assert.equal(f.calls.length,0);
});
