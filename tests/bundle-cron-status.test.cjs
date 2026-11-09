const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.resolve(__dirname,"../app/lib/bundle-cron-status.server.ts");
const transpiled = ts.transpileModule(fs.readFileSync(file,"utf8"),{
 fileName:file,reportDiagnostics:true,
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal((transpiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(transpiled.outputText,{
 exports:mod.exports,module:mod,Date,Number,JSON,Error,console,
},{filename:file});
const {storeDailyCronStatus,parseDailyCronStatus}=mod.exports;
const status={
 checkedAt:"2026-11-07T08:00:00.000Z",ok:true,checked:6,updated:1,unpublished:0,
 requiresAttention:2,errors:[],webhooks:{deletion:true,inventory:true,prices:true}
};
test("parses a verified daily audit record",()=>{
 const parsed=parseDailyCronStatus(JSON.stringify(status));
 assert.equal(parsed.checked,6);
 assert.equal(parsed.ok,true);
});
test("rejects malformed and unverifiable daily records",()=>{
 assert.equal(parseDailyCronStatus("{bad"),null);
 assert.equal(parseDailyCronStatus(JSON.stringify({...status,ok:"true"})),null);
 assert.equal(parseDailyCronStatus(JSON.stringify({...status,checkedAt:"bad"})),null);
 assert.equal(parseDailyCronStatus(JSON.stringify({...status,webhooks:{deletion:true}})),null);
});
test("stores cron outcome on the installed app, not a product",async()=>{
 const writes=[];
 const admin={graphql:async(operation,options)=>{
  if(operation.includes("CsbyteDailyAuditOwner"))
   return {json:async()=>({data:{currentAppInstallation:{id:"gid://shopify/AppInstallation/32"}}})};
  if(operation.includes("CsbyteStoreDailyAuditStatus")){
   writes.push(options.variables.inputs[0]);
   return {json:async()=>({data:{metafieldsSet:{metafields:[{id:"gid://shopify/Metafield/1"}],userErrors:[]}}})};
  }
  throw Error("Unexpected query");
 }};
 await storeDailyCronStatus(admin,status);
 assert.equal(writes.length,1);
 assert.equal(writes[0].ownerId,"gid://shopify/AppInstallation/32");
 assert.equal(writes[0].key,"bundle_daily_cron_status");
 assert.equal(JSON.parse(writes[0].value).checked,6);
});
test("failed record writes are not reported as success",async()=>{
 const admin={graphql:async(op)=>op.includes("CsbyteDailyAuditOwner")
  ?{json:async()=>({data:{currentAppInstallation:{id:"gid://shopify/AppInstallation/32"}}})}
  :{json:async()=>({data:{metafieldsSet:{metafields:[],userErrors:[{message:"Denied"}]}}})}};
 await assert.rejects(storeDailyCronStatus(admin,status),/no confirmó/);
});
