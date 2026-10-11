#!/usr/bin/env node
// Isolated integration QA: actual Redis process + Upstash-compatible HTTPS adapter.
// This test uses a temporary local Redis key and ephemeral auth credentials.
// The TLS bypass below applies exclusively to this disposable loopback QA endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const {spawn,execFileSync} = require('node:child_process');

const redisPort=6397, adapterPort=6647, sitePort=3347;
const base='http://127.0.0.1:'+sitePort;
const testKey='forno-nori:site:published:v1';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'forno-redis-ci-'));
const password='temporary-qa-admin-password-20261011';
const sessionSecret='temporary-qa-session-signing-secret-0123456789-for-testing-only';
let passed=0;
const children=[];
const env={...process.env, NODE_ENV:'production', NODE_TLS_REJECT_UNAUTHORIZED:'0',
  ADMIN_PASSWORD:password,ADMIN_SESSION_SECRET:sessionSecret,
  REDIS_URL:'redis://127.0.0.1:'+redisPort,
  UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:'',NEXT_TELEMETRY_DISABLED:'1'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function redis(...args) {
  return execFileSync('redis-cli',['--raw','-h','127.0.0.1','-p',String(redisPort),...args.map(String)],
    {encoding:'utf8',timeout:7000}).trim();
}
async function http(route,options={}) {
  const response=await fetch(base+route,{...options,signal:AbortSignal.timeout(10000)});
  const text=await response.text();
  let body;
  try {body=JSON.parse(text)} catch {body=text.slice(0,250)}
  return {status:response.status,body,cookie:response.headers.get('set-cookie')};
}
function check(name, condition) {
  assert.ok(condition,name);
  passed++;
  console.log('PASS '+name);
}
(async()=>{
  let rest;
  try {
    const r=spawn('redis-server',['--port',String(redisPort),'--bind','127.0.0.1','--save','','--appendonly','no'],{stdio:'ignore'});
    children.push(r);
    let ready=false;
    for(let i=0;i<50;i++){try{if(redis('PING')==='PONG'){ready=true;break}}catch{}await sleep(100)}
    check('actual Redis starts',ready);
    execFileSync('openssl',['req','-x509','-nodes','-newkey','rsa:2048','-keyout',temp+'/key.pem',
      '-out',temp+'/cert.pem','-days','1','-subj','/CN=localhost'],{stdio:'ignore',timeout:20000});
    rest=https.createServer({key:fs.readFileSync(temp+'/key.pem'),cert:fs.readFileSync(temp+'/cert.pem')},
      async(req,res)=>{
        let status=200,body;
        try{
          if(req.headers.authorization!=='Bearer integration-local-only')throw Error('unauthorized');
          if(req.method==='GET'&&req.url.startsWith('/get/')){
            const val=redis('GET',decodeURIComponent(req.url.slice(5)));
            body={result:val||null};
          } else if(req.method==='POST'&&req.url==='/pipeline'){
            let input='';
            for await(const chunk of req)input+=chunk.toString();
            const commands=JSON.parse(input);
            body=commands.map(cmd=>({result:Number(redis(...cmd))}));
          } else {status=404;body={error:'not found'}}
        }catch(e){status=500;body={error:String(e.message)}}
        res.writeHead(status,{'Content-Type':'application/json'});
        res.end(JSON.stringify(body));
      });
    await new Promise(resolve=>rest.listen(adapterPort,'127.0.0.1',resolve));
    const web=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname',
      '127.0.0.1','--port',String(sitePort)],{cwd:process.cwd(),env,stdio:'ignore'});
    children.push(web);
    let up=false;
    for(let i=0;i<80;i++){try{const r=await http('/api/admin/session');if(r.status===200){up=true;break}}catch{}await sleep(150)}
    check('production Next server starts',up);
    const initial=await http('/api/content');
    check('CMS reads genuine Redis over native TCP',initial.status===200 && initial.body.persistent===true && initial.body.revision===0 && !!initial.body.data);
    // Next.js normalizes the loopback request origin to localhost in production mode.
    const origin='http://localhost:'+sitePort;
    const json={'Content-Type':'application/json',Origin:origin};
    const unauth=await http('/api/content',{method:'PUT',headers:json,body:'{}'});
    check('unauthenticated publish rejected',unauth.status===401);
    const invalidLogin=await http('/api/admin/login',{method:'POST',headers:json,body:JSON.stringify({password:'incorrect'})});
    console.log('INVALID_LOGIN_DIAGNOSTIC',invalidLogin.status,JSON.stringify(invalidLogin.body).slice(0,220));
    check('invalid admin login rejected',invalidLogin.status===401);
    const login=await http('/api/admin/login',{method:'POST',headers:json,body:JSON.stringify({password})});
    console.log('VALID_LOGIN_DIAGNOSTIC',login.status,JSON.stringify(login.body).slice(0,220));
    check('admin login gets signed cookie',login.status===200 && !!login.cookie?.includes('fn_admin='));
    const cookie=login.cookie.split(';')[0];
    const userData=initial.body.data;
    const wrongOrigin=await http('/api/content',{method:'PUT',headers:{...json,Origin:'https://bad-origin.invalid',Cookie:cookie},body:JSON.stringify({data:userData,revision:0})});
    check('CSRF wrong origin rejected',wrongOrigin.status===403);
    const publish=await http('/api/content',{method:'PUT',headers:{...json,Cookie:cookie},body:JSON.stringify({data:userData,revision:0})});
    check('publishes revision 1',publish.status===200 && publish.body.revision===1);
    check('Redis stores revision 1',JSON.parse(redis('GET',testKey)).revision===1);
    const reread=await http('/api/content');
    check('published data read back over HTTP',reread.status===200 && reread.body.revision===1);
    const conflict=await http('/api/content',{method:'PUT',headers:{...json,Cookie:cookie},body:JSON.stringify({data:userData,revision:0})});
    check('stale editor gets 409',conflict.status===409);
    const update=await http('/api/content',{method:'PUT',headers:{...json,Cookie:cookie},body:JSON.stringify({data:userData,revision:1})});
    check('authorized revision 2 published',update.status===200 && update.body.revision===2);
    check('Redis persists revision 2',JSON.parse(redis('GET',testKey)).revision===2);
    console.log('REDIS_CMS_INTEGRATION '+passed+'/'+passed+' passed');
  } finally {
    try {redis('DEL',testKey)}catch{}
    if(rest)await new Promise(resolve=>rest.close(resolve));
    for(const c of children)try{c.kill('SIGTERM')}catch{}
    fs.rmSync(temp,{recursive:true,force:true});
  }
})().catch(e=>{console.error('REDIS_CMS_INTEGRATION_FAILED',e.stack||e.message);process.exitCode=1});
