const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relative, modules = {}) {
  const sourcePath = path.resolve(__dirname, "../", relative);
  const { outputText, diagnostics } = ts.transpileModule(
    fs.readFileSync(sourcePath, "utf8"),
    { fileName: sourcePath, reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  assert.equal((diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const ref = { exports: {} };
  vm.runInNewContext(outputText, {
    exports: ref.exports, module: ref, console, Date, Map, Number, JSON,
    require: (name) => {
      if (!(name in modules)) throw Error("Unexpected import " + name);
      return modules[name];
    },
  }, { filename: relative });
  return ref.exports;
}
const engine = loadTs("app/lib/bundle-engine.ts");

function createFixture(options = {}) {
  const price = options.editedPrice ?? 155000;
  const status = options.componentStatus || "ACTIVE";
  const sources = [
    { id:"gid://shopify/Product/90010", variant:"gid://shopify/ProductVariant/9010",
      sku:"TEST-PC-9010", price:"100000", title:"PC de prueba" },
    { id:"gid://shopify/Product/90020", variant:"gid://shopify/ProductVariant/9020",
      sku:"TEST-MON-9020", price:String(options.monitorPrice ?? 60000), title:"Monitor de prueba" },
    { id:"gid://shopify/Product/90030", variant:"gid://shopify/ProductVariant/9030",
      sku:"TEST-KM-9030", price:"10000", title:"Teclado de prueba" },
  ];
  let snapshot = {
    schemaVersion:2, sku:"BND-TEST-9010", finalPrice:155000,
    base:{productId:sources[0].id,variantId:sources[0].variant},
    monitor:{productId:sources[1].id,variantId:sources[1].variant},
    keyboardMouse:{productId:sources[2].id,variantId:sources[2].variant},
    wifiAdapter:null,
  };
  const parent = { id:"gid://shopify/ProductVariant/9999",
    sku:"BND-TEST-9010", price:String(price), compareAtPrice:"160000", inventoryQuantity:8 };
  const bundle = {
    id:"gid://shopify/Product/90000", title:"Bundle de prueba",
    status:"DRAFT", totalInventory:8,
    managedBy:{value:"csbyte-commerce-tools"},
    snapshotMeta:{value:JSON.stringify(snapshot),compareDigest:null},
    variants:{nodes:[parent]},
    bundleComponents:{ nodes:sources.map((p,i)=>({
      quantity:1,
      componentProduct:{id:p.id,title:p.title,status:i===1?status:"ACTIVE",totalInventory:20},
      componentVariants:{nodes:[{id:p.variant,sku:p.sku,price:p.price,inventoryQuantity:20}],
        pageInfo:{hasNextPage:false}},
    })),pageInfo:{hasNextPage:false}},
  };
  const updates = [];
  const admin = { graphql: async (operation, { variables } = {}) => {
    let data;
    if (operation.includes("CsbyteManagedBundlePriceAudit")) {
      data = {products:{nodes:[bundle],pageInfo:{hasNextPage:false,endCursor:null}}};
    } else if (operation.includes("CsbyteSyncManagedBundlePrice")) {
      updates.push(variables.variants[0]);
      parent.price = variables.variants[0].price;
      parent.compareAtPrice = variables.variants[0].compareAtPrice;
      data = {productVariantsBulkUpdate:{
        productVariants:[{id:parent.id,price:parent.price,compareAtPrice:parent.compareAtPrice}],
        userErrors:[],
      }};
    } else if (operation.includes("CsbyteUpdateBundlePriceSnapshot")) {
      snapshot = JSON.parse(variables.inputs[0].value);
      data = {metafieldsSet:{metafields:[{id:"gid://shopify/Metafield/80001",
        value:JSON.stringify(snapshot)}],userErrors:[]}};
    } else {
      throw new Error("Unrecognized GraphQL call " + operation.slice(0,65));
    }
    return {json:async()=>({data})};
  }};
  const settings = {loadBundleRuntimeSettings:async()=>({
    errors:[],
    priceConfig:{configured:options.configured!==false,mode:"percentage",
      percentage:5,rounding:"none",fixedAmount:0},
  })};
  const sync = loadTs("app/lib/bundle-sync.server.ts",{
    "./bundle-engine":engine,
    "./bundle-runtime-settings.server":settings,
    "./bundle-sku-guard.server":{auditComponentSkuUniqueness:async()=>[]},
  });
  return {admin, bundle, updates, getSnapshot:()=>snapshot,
    run:(apply)=>sync.runManagedBundleSync(admin,{apply,saveReport:false})};
}

test("recalculates a Bundle when monitor price rises by 10000 CLP",async()=>{
  const f=createFixture();
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(report.updated,1);
  assert.equal(f.updates.length,1);
  assert.equal(Number(f.updates[0].price),165000);
  assert.equal(Number(f.updates[0].compareAtPrice),170000);
  assert.equal(f.getSnapshot().finalPrice,165000);
});
test("preview reports difference but makes no Shopify mutation",async()=>{
  const f=createFixture();
  const report=await f.run(false);
  assert.equal(report.updated,0);
  assert.equal(report.rows[0].expectedPrice,165000);
  assert.equal(f.updates.length,0);
});
test("respects manual parent price edit",async()=>{
  const f=createFixture({editedPrice:154900});
  const report=await f.run(true);
  assert.equal(report.updated,0);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/editado fuera de la app/);
});
test("rule absent blocks changes",async()=>{
  const f=createFixture({configured:false});
  const report=await f.run(true);
  assert.equal(report.updated,0);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/configurar la regla/);
});
test("unpublished monitor blocks price update",async()=>{
  const f=createFixture({componentStatus:"DRAFT"});
  const report=await f.run(true);
  assert.equal(report.updated,0);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/no publicado/);
});