const fs=require('node:fs');
const p='src/lib/published-store.ts';
let s=fs.readFileSync(p,'utf8');
if(!s.includes("const token=process.env.UPSTASH_REDIS_REST_TOKEN;"))throw Error('Unknown V6.2.1 baseline');
s=s.replace("import {cache} from 'react';","import {cache} from 'react';\nimport Redis from 'ioredis';");
s=s.replace("export const hasPublishedStore=Boolean(url?.startsWith('https://')&&token);",[
 "const nativeUrl=process.env.REDIS_URL||'';",
 "const nativeMode=/^rediss?:\\/\\/[^\\s]+$/i.test(nativeUrl);",
 "export const hasPublishedStore=nativeMode||Boolean(url?.startsWith('https://')&&token);",
 "const g=globalThis as typeof globalThis & {__fnRedis?:Redis;__fnPending?:Promise<Redis>};",
 "async function nativeRedis():Promise<Redis>{",
 " if(!g.__fnRedis||['end','close'].includes(g.__fnRedis.status)){",
 "  g.__fnRedis=new Redis(nativeUrl,{lazyConnect:true,enableOfflineQueue:false,maxRetriesPerRequest:1,connectTimeout:3500,commandTimeout:5000,retryStrategy:()=>null});",
 "  g.__fnRedis.on('error',()=>{});g.__fnPending=undefined;",
 " }",
 " const client=g.__fnRedis;",
 " if(client.status==='ready')return client;",
 " if(!g.__fnPending)g.__fnPending=client.connect().then(()=>client).finally(()=>{g.__fnPending=undefined});",
 " return g.__fnPending;",
 "}"
].join('\n'));
const start=s.indexOf(' const response=await fetch(');
const finish=s.indexOf(' const parsed:unknown=JSON.parse(body.result);');
if(start<0||finish<0)throw Error('Read code not found');
const readCode=[
 " let raw:string|null;",
 " if(nativeMode)raw=await(await nativeRedis()).get(KEY);",
 " else{",
 "  const response=await fetch(url+'/get/'+encodeURIComponent(KEY),{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(6500)});",
 "  if(!response.ok)throw Error('Published store returned '+response.status);",
 "  const body=await response.json() as {result:string|null};",
 "  raw=body.result;",
 " }",
 " if(raw===null)return defaultRecord;",
 " const parsed:unknown=JSON.parse(raw);"
].join('\n');
s=s.slice(0,start)+readCode+s.slice(finish+" const parsed:unknown=JSON.parse(body.result);".length);
const endStart=s.indexOf(" const response=await fetch(",s.indexOf('export async function publishContent'));
const end=s.indexOf('\n}',endStart);
if(endStart<0||end<0)throw Error('Publish code not found');
const publishCode=[
 " let success:number|null;",
 " if(nativeMode)success=Number(await(await nativeRedis()).eval(lua,1,KEY,String(expectedRevision),JSON.stringify(newRecord)));",
 " else{",
 "  const response=await fetch(url+'/pipeline',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify([['EVAL',lua,'1',KEY,String(expectedRevision),JSON.stringify(newRecord)]]),cache:'no-store',signal:AbortSignal.timeout(10000)});",
 "  if(!response.ok)throw Error('Publish failed ('+response.status+')');",
 "  const body=await response.json() as Array<{result:number|null;error?:string}>;",
 "  if(body[0]?.error)throw Error('Storage operation rejected');",
 "  success=body[0]?.result??null;",
 " }",
 " return success===1?newRecord:{conflict:true};"
].join('\n');
s=s.slice(0,endStart)+publishCode+s.slice(end);
s=s.replace("throw Error('Connect UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN first')","throw Error('Connect REDIS_URL or Upstash REST first')");
fs.writeFileSync(p,s);
const packageFile=JSON.parse(fs.readFileSync('package.json','utf8'));
packageFile.version='6.3.0';
packageFile.dependencies.ioredis='^5.4.2';
fs.writeFileSync('package.json',JSON.stringify(packageFile,null,2)+'\n');
console.log('Native Redis and Upstash dual-provider patch applied');
