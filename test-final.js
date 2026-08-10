const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const ctx=await b.newContext({...devices['iPhone 12'], viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  const p=await ctx.newPage();
  const all=[]; p.on('pageerror',e=>all.push('PE '+e.message)); p.on('console',m=>{if(m.type()==='error')all.push('CE '+m.text());});
  await p.goto('http://127.0.0.1:8070/index.html',{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(1500);
  await p.click('[data-k=start]');
  await p.evaluate(()=>{const g=window.Apollo.Game;g.__setThrottleActive(true);g.__setThrottle(0.8);});
  await p.waitForTimeout(1500);
  const fly=await p.evaluate(()=>({status:(window.Apollo.State||{}).status, thrust:(window.Apollo.State||{}).thrust}));
  await p.screenshot({path:'/tmp/final-flight.png'});
  // cut -> crash
  await p.evaluate(()=>{window.Apollo.Game.__setThrottleActive(true);window.Apollo.Game.__setThrottle(0);});
  let st=''; for(let i=0;i<60;i++){await p.waitForTimeout(400);st=await p.evaluate(()=>(window.Apollo.State||{}).status);if(st==='crashed'||st==='landed')break;}
  const v=await p.evaluate(()=>{const e=document.querySelector('.apollo-verdict');return {shown:e&&e.classList.contains('show'), pay:(e&&e.querySelector('.vd-pay')||{}).textContent||null, refuel:!!(e&&e.querySelector('.vd-refuel'))};});
  console.log('FLY',JSON.stringify(fly),'END',st,'VERDICT',JSON.stringify(v),'ERRORS',JSON.stringify(all).slice(0,200));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
