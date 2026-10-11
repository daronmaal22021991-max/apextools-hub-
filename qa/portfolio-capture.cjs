const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(require('node:path').resolve(process.cwd(),'node_modules/playwright'));
const OUT=path.resolve(process.cwd(),'../../PORTFOLIO_MEDIA_CAPTURES');
fs.mkdirSync(OUT,{recursive:true});
const entries=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function settle(page,full=false){
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForTimeout(550);
 if(full){
  await page.evaluate(async()=>{const h=document.body.scrollHeight;for(let y=0;y<h;y+=650){scrollTo(0,y);await new Promise(r=>setTimeout(r,70))}scrollTo(0,0)});
  await page.waitForTimeout(700);
 }
 await page.evaluate(async()=>{const vis=[...document.querySelectorAll('img')].filter(i=>{const b=i.getBoundingClientRect();return b.bottom>=-20&&b.top<window.innerHeight+120});await Promise.all(vis.map(x=>x.decode().catch(()=>{})))});
 await page.addStyleTag({content:'html{scroll-behavior:auto!important}html,body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}.nextjs-toast,.nextjs-portal,[data-nextjs-dialog-overlay]{display:none!important}'});
}
async function save(page,name,options={}){
 const file=path.join(OUT,name+'.png');
 await page.screenshot({path:file,animations:'disabled',...options});
 entries.push({file:name+'.png',bytes:fs.statSync(file).size,viewport:page.viewportSize(),fullPage:!!options.fullPage});
 console.log('CAPTURED',name,fs.statSync(file).size);
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const m of [{id:'desktop',width:1440,height:900,mobile:false},{id:'mobile',width:390,height:844,mobile:true}]){
   const context=await browser.newContext({viewport:{width:m.width,height:m.height},deviceScaleFactor:2,isMobile:m.mobile,hasTouch:m.mobile,locale:'en-US',reducedMotion:'reduce'});
   const page=await context.newPage();
   page.setDefaultTimeout(12000);
   page.on('pageerror',e=>console.log('PAGE_ERROR',m.id,e.message.slice(0,200)));
   for(const [slug,route] of [['home','/'],['pizza','/pizza'],['rolls','/rolls'],['information','/information']]){
    const resp=await page.goto('http://127.0.0.1:3000'+route,{waitUntil:'domcontentloaded',timeout:30000});
    if(resp.status()!==200)throw Error('HTTP '+resp.status()+' '+route);
    await settle(page,false);
    await save(page,m.id+'-'+slug+'-fold');
    await settle(page,true);
    await save(page,m.id+'-'+slug+'-full',{fullPage:true});
   }
   await page.goto('http://127.0.0.1:3000/pizza',{waitUntil:'domcontentloaded'});
   await settle(page);
   await page.locator('.fn-product-row').first().hover({force:true});
   await save(page,m.id+'-pizza-hover');
   const row=page.locator('.fn-product-row').first();
   await row.getByRole('button',{name:/Add to cart:/i}).click();
   const second=page.locator('.fn-product-row').nth(1);
   await second.getByRole('button',{name:/Add to cart:/i}).click();
   if(m.mobile){
    await save(page,'mobile-cartbar');
    await page.locator('.fn-cartbar').click();
   } else{
    await page.getByRole('button',{name:/Open cart with/i}).click();
   }
   await settle(page);
   await save(page,m.id+'-cart-two-items');
   const cart=page.getByRole('dialog',{name:'Cart'});
   if(await cart.count()){
    await cart.screenshot({path:path.join(OUT,m.id+'-cart-detail.png'),animations:'disabled'});
    entries.push({file:m.id+'-cart-detail.png',bytes:fs.statSync(path.join(OUT,m.id+'-cart-detail.png')).size,kind:'detail'});
   }
   await page.keyboard.press('Escape');
   await page.goto('http://127.0.0.1:3000/',{waitUntil:'domcontentloaded'});
   await settle(page);
   for(const [name,sel] of [['hero','.fn-hero'],['menu-card','.fn-feature-card'],['footer','footer']]){
    const loc=page.locator(sel).first();
    if(await loc.count()){await loc.scrollIntoViewIfNeeded();await sleep(300);await loc.screenshot({path:path.join(OUT,m.id+'-'+name+'-detail.png'),animations:'disabled',timeout:20000});entries.push({file:m.id+'-'+name+'-detail.png',bytes:fs.statSync(path.join(OUT,m.id+'-'+name+'-detail.png')).size,kind:'detail'});console.log('DETAIL',m.id,name)}
   }
   await context.close();
  }
  fs.writeFileSync(path.join(OUT,'CAPTURE_MANIFEST.json'),JSON.stringify({source:'Next.js V6.3 patch applied to original v6.2.1 ZIP; production server; Chromium; deviceScaleFactor 2',capturedAt:new Date().toISOString(),entries},null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
