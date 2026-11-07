const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../app/lib/bundle-live-status.server.ts");
const source = fs.readFileSync(filename, "utf8");
const {outputText,diagnostics} = ts.transpileModule(source,{
  fileName:filename,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal((diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(outputText,{exports:mod.exports,module:mod,Date,Number,JSON,Error,Array,console}, {filename});
const {loadLiveBundleSnapshot}=mod.exports;

function item(id,status,managed=true) {
  return {
    id:"gid://shopify/Product/"+id,title:"Bundle "+id,status,totalInventory:status==="DRAFT"?0:8,
    managedBy:{value:managed?"csbyte-commerce-tools":"another-app"},
    variants:{nodes:[{sku:"BND-"+id,price:"99000"}],pageInfo:{hasNextPage:false}},
  };
}
function fixture(pages) {
  let calls=0;
  const admin={graphql:async(_operation,{variables})=>{
    const page=pages[calls++];
    assert.equal(variables.after??null,page.expectedAfter??null);
    return {json:async()=>page.body};
  }};
  return {admin,getCalls:()=>calls};
}

test("current Shopify status takes precedence over any saved audit report",async()=>{
  const f=fixture([{body:{data:{products:{nodes:[item("1","DRAFT"),item("2","ACTIVE")],
    pageInfo:{hasNextPage:false,endCursor:null}}}}}]);
  const result=await loadLiveBundleSnapshot(f.admin);
  assert.equal(result.error,null);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows[0].status,"DRAFT");
  assert.equal(result.rows[0].available,0);
  assert.equal(result.rows[1].status,"ACTIVE");
  assert.equal(f.getCalls(),1);
});
test("foreign bundles are excluded from live management",async()=>{
  const f=fixture([{body:{data:{products:{nodes:[item("1","ACTIVE",false)],
    pageInfo:{hasNextPage:false}}}}}]);
  const r=await loadLiveBundleSnapshot(f.admin);
  assert.equal(r.error,null);
  assert.equal(r.rows.length,0);
});
test("paginates without silently truncating the catalog",async()=>{
  const f=fixture([
    {expectedAfter:null,body:{data:{products:{nodes:[item("1","DRAFT")],
      pageInfo:{hasNextPage:true,endCursor:"C1"}}}}},
    {expectedAfter:"C1",body:{data:{products:{nodes:[item("2","ACTIVE")],
      pageInfo:{hasNextPage:false,endCursor:"C2"}}}}},
  ]);
  const r=await loadLiveBundleSnapshot(f.admin);
  assert.equal(r.error,null);
  assert.equal(r.rows.length,2);
  assert.equal(f.getCalls(),2);
});
test("failed Shopify response does not display partial data as live",async()=>{
  const f=fixture([
    {body:{data:{products:{nodes:[item("1","ACTIVE")],pageInfo:{hasNextPage:true,endCursor:"A"}}}}},
    {expectedAfter:"A",body:{errors:[{message:"Shopify unavailable"}]}}
  ]);
  const r=await loadLiveBundleSnapshot(f.admin);
  assert.equal(r.rows.length,0);
  assert.match(r.error,/Shopify unavailable/);
});
test("invalid prices and multi-variant bundles show no unverified price",async()=>{
  const multi=item("1","ACTIVE");
  multi.variants.nodes.push({sku:"BND-1-2",price:"150000"});
  const f=fixture([{body:{data:{products:{nodes:[multi],pageInfo:{hasNextPage:false}}}}}]);
  const r=await loadLiveBundleSnapshot(f.admin);
  assert.equal(r.rows[0].price,null);
});
