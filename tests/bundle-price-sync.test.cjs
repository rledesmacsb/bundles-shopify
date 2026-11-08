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
    ...(!options.legacySnapshot ? {compareAtPrice:160000} : {}),
    base:{productId:sources[0].id,variantId:sources[0].variant},
    monitor:{productId:sources[1].id,variantId:sources[1].variant},
    keyboardMouse:{productId:sources[2].id,variantId:sources[2].variant},
    wifiAdapter:null,
  };
  const weights = [1200, 2700, 500];
  const totalGrams = weights.reduce((sum, x) => sum + x, 0);
  const startingWeight = options.parentWeightGrams ?? totalGrams;
  const parent = { id:"gid://shopify/ProductVariant/9999",
    sku:"BND-TEST-9010", price:String(price), compareAtPrice:options.editedCompareAtPrice===null?null:String(options.editedCompareAtPrice??160000), inventoryQuantity:8,
    inventoryItem:{measurement:{weight:{value:startingWeight/1000,
      unit:"KILOGRAMS"}}} };
  const bundle = {
    id:"gid://shopify/Product/90000", title:"Bundle de prueba",
    status:options.bundleStatus || "DRAFT", totalInventory:8,
    managedBy:{value:"csbyte-commerce-tools"},
    snapshotMeta:{value:JSON.stringify(snapshot),compareDigest:null},
    variants:{nodes:[parent]},
    bundleComponents:{ nodes:sources.map((p,i)=>({
      quantity:1,
      componentProduct:{id:p.id,title:p.title,status:i===1?status:"ACTIVE",totalInventory:i===1?(options.monitorStock ?? 20):20},
      componentVariants:{nodes:[{id:p.variant,sku:p.sku,price:p.price,inventoryQuantity:i===1?(options.monitorStock ?? 20):20,
        inventoryItem:{measurement:{weight:{value:(options.componentWeightsGrams?.[i] ?? weights[i])/1000,unit:"KILOGRAMS"}}}}],
        pageInfo:{hasNextPage:false}},
    })),pageInfo:{hasNextPage:false}},
  };
  const updates = [];
  const weightUpdates = [];
  const admin = { graphql: async (operation, { variables } = {}) => {
    let data;
    if (operation.includes("CsbyteManagedBundlePriceAudit")) {
      data = {products:{nodes:[bundle],pageInfo:{hasNextPage:false,endCursor:null}}};
    } else if (operation.includes("CsbyteWeightSyncRecheck")) {
      data = {product:{...bundle,
        bundleComponents:{...bundle.bundleComponents,nodes:bundle.bundleComponents.nodes.map(x=>({
          ...x,componentVariants:x.componentVariants,
        }))}}};
    } else if (operation.includes("CsbyteSyncManagedBundleWeight")) {
      const grams = variables.variants[0].inventoryItem.measurement.weight.value*1000;
      weightUpdates.push(grams);
      parent.inventoryItem.measurement.weight = variables.variants[0].inventoryItem.measurement.weight;
      data = {productVariantsBulkUpdate:{productVariants:[{...parent}],userErrors:[]}};
    } else if (operation.includes("CsbytePriceWebhookRecheck")) {
      if (options.manualEditDuringRecheck) parent.price = "154900";
      if (options.manualCompareDuringRecheck) parent.compareAtPrice = "159900";
      data = {product:{id:bundle.id,managedBy:bundle.managedBy,
        snapshotMeta:bundle.snapshotMeta,variants:{nodes:[parent]}}};
    } else if (operation.includes("CsbyteCompareBaselineRecheck")) {
      data = {product:{id:bundle.id,managedBy:bundle.managedBy,
        snapshotMeta:bundle.snapshotMeta,variants:{nodes:[parent]}}};
    } else if (operation.includes("CsbytePersistCompareBaseline")) {
      const newSnapshot = JSON.parse(variables.inputs[0].value);
      snapshot = newSnapshot;
      bundle.snapshotMeta.value = JSON.stringify(newSnapshot);
      data = {metafieldsSet:{metafields:[{id:"gid://shopify/Metafield/80001",
        value:bundle.snapshotMeta.value}],userErrors:[]}};
    } else if (operation.includes("CsbyteSyncManagedBundlePrice")) {
      updates.push(variables.variants[0]);
      parent.price = variables.variants[0].price;
      parent.compareAtPrice = variables.variants[0].compareAtPrice;
      data = {productVariantsBulkUpdate:{
        productVariants:[{id:parent.id,price:parent.price,compareAtPrice:parent.compareAtPrice}],
        userErrors:[],
      }};
    } else if (operation.includes("CsbyteRecheckBundleBeforeDraft")) {
      if (options.restoreStockBeforeRecheck) {
        bundle.bundleComponents.nodes[1].componentProduct.totalInventory = 20;
        bundle.bundleComponents.nodes[1].componentVariants.nodes[0].inventoryQuantity = 20;
      }
      data = { product: bundle };
    } else if (operation.includes("CsbyteDisableInvalidBundle")) {
      bundle.status = variables.input.status;
      data = { productUpdate: {
        product: {id: bundle.id, status: bundle.status}, userErrors:[],
      }};
    } else if (operation.includes("CsbyteUpdateBundlePriceSnapshot")) {
      snapshot = JSON.parse(variables.inputs[0].value);
      bundle.snapshotMeta.value = JSON.stringify(snapshot);
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
  return {admin, bundle, updates, weightUpdates, getSnapshot:()=>snapshot,
    run:(apply,changedComponentProductId)=>sync.runManagedBundleSync(admin,{apply,saveReport:false,changedComponentProductId})};
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

test("daily audit keeps native Bundle active at zero stock",async()=>{
  const f=createFixture({bundleStatus:"ACTIVE",monitorStock:0});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(report.unpublished,0);
  assert.equal(report.rows[0].status,"ACTIVE");
  assert.equal(f.bundle.status,"ACTIVE");
  assert.equal(f.updates.length,1);
  assert.equal(Number(f.updates[0].price),165000);
  assert.match(report.rows[0].issues.join(" "),/sin stock/);
});

test("read-only audit flags out-of-stock Bundle without changing its status",async()=>{
  const f=createFixture({bundleStatus:"ACTIVE",monitorStock:0});
  const report=await f.run(false);
  assert.equal(report.unpublished,0);
  assert.equal(f.bundle.status,"ACTIVE");
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/sin stock/);
});

test("replenished Bundle stays active and price audit can proceed",async()=>{
  const f=createFixture({bundleStatus:"ACTIVE",monitorStock:9});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(report.unpublished,0);
  assert.equal(f.bundle.status,"ACTIVE");
  assert.equal(report.updated,1);
});

test("product update only processes Bundles referencing the changed component",async()=>{
  const f=createFixture();
  const unrelated=await f.run(true,"gid://shopify/Product/888888");
  assert.equal(unrelated.total,0);
  assert.equal(unrelated.updated,0);
  const relevant=await f.run(true,"gid://shopify/Product/90020");
  assert.equal(relevant.total,1);
  assert.equal(relevant.updated,1);
});

test("concurrent manual price edit blocks an automatic update",async()=>{
  const f=createFixture({manualEditDuringRecheck:true});
  const report=await f.run(true,"gid://shopify/Product/90020");
  assert.equal(report.updated,0);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/Bundle cambió durante la sincronización/);
});

test("updates weight and reconciles an independently stale price on component webhook",async()=>{
  const f=createFixture({componentWeightsGrams:[1200,3000,500]});
  const report=await f.run(true,"gid://shopify/Product/90020");
  assert.equal(report.errors.length,0);
  assert.equal(report.updated,1);
  assert.equal(f.weightUpdates.length,1);
  assert.equal(f.weightUpdates[0],4700);
  assert.equal(f.updates.length,1);
  assert.equal(Number(f.updates[0].price),165000);
  assert.equal(report.rows[0].weightUpdated,true);
});

test("weight sync respects a manually edited parent price",async()=>{
  const f=createFixture({editedPrice:154900,componentWeightsGrams:[1200,3000,500]});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(f.weightUpdates[0],4700);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/editado fuera de la app/);
});

test("weight preview never writes changes",async()=>{
  const f=createFixture({componentWeightsGrams:[1200,3000,500]});
  const report=await f.run(false);
  assert.equal(f.weightUpdates.length,0);
  assert.equal(report.rows[0].expectedWeightGrams,4700);
  assert.match(report.rows[0].issues.join(" "),/peso del Bundle necesita/);
});

test("weight recalculates without a price rule",async()=>{
  const f=createFixture({configured:false,componentWeightsGrams:[1200,3000,500]});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(f.weightUpdates[0],4700);
  assert.equal(f.updates.length,0);
});

test("does not write weight when component weight is missing",async()=>{
  const f=createFixture({componentWeightsGrams:[1200,0,500]});
  const report=await f.run(true);
  assert.equal(f.weightUpdates.length,0);
  assert.match(report.rows[0].issues.join(" "),/peso válido/);
});

test("daily audit drafts published Bundle when a component is inactive",async()=>{
  const f=createFixture({bundleStatus:"ACTIVE",componentStatus:"DRAFT",monitorStock:20});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(report.unpublished,1);
  assert.equal(f.bundle.status,"DRAFT");
  assert.equal(f.updates.length,0);
});

test("manual compare-at edit is never overwritten",async()=>{
  const f=createFixture({editedCompareAtPrice:159900});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(report.updated,0);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/Precio de comparación editado/);
});

test("concurrent manual compare-at edit blocks a write",async()=>{
  const f=createFixture({manualCompareDuringRecheck:true});
  const report=await f.run(true);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/Bundle cambió durante la sincronización/);
});

test("legacy compare-at mismatch is held without overwriting",async()=>{
  const f=createFixture({legacySnapshot:true});
  const report=await f.run(true);
  assert.equal(report.errors.length,0);
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/heredado sin referencia segura/);
});

test("matching legacy compare-at is adopted before subsequent changes",async()=>{
  const f=createFixture({legacySnapshot:true,monitorPrice:50000});
  const first=await f.run(true);
  assert.equal(first.errors.length,0);
  assert.equal(f.updates.length,0);
  assert.equal(f.getSnapshot().compareAtPrice,160000);
  const monitor=f.bundle.bundleComponents.nodes[1].componentVariants.nodes[0];
  monitor.price="60000";
  const second=await f.run(true);
  assert.equal(second.errors.length,0);
  assert.equal(f.updates.length,1);
  assert.equal(Number(f.updates[0].compareAtPrice),170000);
});

test("zero stock and manual compare-at edit retain commercial protections",async()=>{
  const f=createFixture({bundleStatus:"ACTIVE",monitorStock:0,editedCompareAtPrice:159900});
  const report=await f.run(true);
  assert.equal(report.unpublished,0);
  assert.equal(f.bundle.status,"ACTIVE");
  assert.equal(f.updates.length,0);
  assert.match(report.rows[0].issues.join(" "),/Precio de comparación editado/);
});
