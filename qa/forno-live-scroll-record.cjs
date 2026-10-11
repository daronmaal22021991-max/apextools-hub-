const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.resolve(process.cwd(),'node_modules/playwright'));
const OUT=path.resolve(process.cwd(),'../../PORTFOLIO_SCROLL_CLIPS');
fs.mkdirSync(OUT,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const spec of [
   {name:'desktop-home',url:'/',w:1280,h:800,isMobile:false,maxScroll:2600},
   {name:'desktop-pizza',url:'/pizza',w:1280,h:800,isMobile:false,maxScroll:1800},
   {name:'mobile-home',url:'/',w:390,h:844,isMobile:true,maxScroll:2300},
   {name:'mobile-pizza',url:'/pizza',w:390,h:844,isMobile:true,maxScroll:1800}
  ]){
   const ctx=await browser.newContext({viewport:{width:spec.w,height:spec.h},deviceScaleFactor:1,recordVideo:{dir:OUT,size:{width:spec.w,height:spec.h}},isMobile:spec.isMobile,hasTouch:spec.isMobile,locale:'en-US',reducedMotion:'reduce'});
   const page=await ctx.newPage();
   const r=await page.goto('http://127.0.0.1:3000'+spec.url,{waitUntil:'domcontentloaded',timeout:25000});
   if(r.status()!==200)throw Error('HTTP '+r.status());
   await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(async()=>{
     for(let y=0;y<document.body.scrollHeight;y+=800){scrollTo(0,y);await new Promise(r=>setTimeout(r,90))}
     scrollTo(0,0);
     await Promise.all([...document.images].filter(i=>i.getBoundingClientRect().top<innerHeight+500).map(i=>i.decode().catch(()=>{})));
   });
   await sleep(350);
   await page.evaluate(async maxScroll=>{
     const dest=Math.min(maxScroll,document.documentElement.scrollHeight-innerHeight);
     const start=performance.now();const duration=5600;
     await new Promise(resolve=>{
       function step(now){let t=Math.max(0,Math.min(1,(now-start)/duration)),ease=t*t*(3-2*t);scrollTo(0,Math.round(dest*ease));if(t>=1)resolve();else requestAnimationFrame(step)}
       requestAnimationFrame(step);
     });
   },spec.maxScroll);
   await sleep(650);
   const v=await page.video.path();await page.close();await ctx.close();
   fs.renameSync(v,path.join(OUT,spec.name+'.webm'));
   console.log('LIVE_SCROLL_RECORDED',spec.name,fs.statSync(path.join(OUT,spec.name+'.webm')).size);
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
