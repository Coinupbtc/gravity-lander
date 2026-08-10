const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const ctx=await b.newContext({...devices['iPhone 12'], viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  const p=await ctx.newPage();
  const all=[];
  p.on('pageerror',e=>all.push('PAGEERROR '+e.message));
  p.on('console',m=>{ if(m.type()==='error') all.push('CONSOLE '+m.text()); });
  await p.goto('http://127.0.0.1:8070/index.html',{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(1500);
  // verify sRGB renderer is actually set now (r128 API)
  const srgb = await p.evaluate(()=>{
    const r = window.Apollo.Game._getRenderer();
    const texrgb = !!window.THREE && THREE.sRGBEncoding !== undefined;
    return { outputEncoding: r ? r.outputEncoding : 'none', sRGBEncodingDefined: texrgb, toneMapping: r?r.toneMapping:'none' };
  });
  console.log('SRGB', JSON.stringify(srgb));
  // start + thrust, check THRUST% and plume alive + glow
  await p.click('[data-k=start]');
  await p.evaluate(()=>{ const g=window.Apollo.Game; g.__setThrottleActive(true); g.__setThrottle(0.75); });
  await p.waitForTimeout(1200);
  const fly = await p.evaluate(()=>{
    const st=window.Apollo.State;
    // read THRUST HUD text
    const tel=document.querySelector('.apollo-telemetry');
    const thrustEl=Array.from(document.querySelectorAll('.apollo-row')).find(r=>r.querySelector('.label')&&r.querySelector('.label').textContent==='THRUST');
    const fx=window.Apollo.FX;
    return { status:st.status, thrustHud: thrustEl?thrustEl.querySelector('.value').textContent:null,
      stThrust: st.thrust, audioReady: (window.Apollo.Audio||{}).ready };
  });
  console.log('FLY', JSON.stringify(fly));
  // cut thrust -> crash, verify one-shot + verdict fuel %
  await p.evaluate(()=>{ window.Apollo.Game.__setThrottleActive(true); window.Apollo.Game.__setThrottle(0); });
  let status=''; for(let i=0;i<60;i++){ await p.waitForTimeout(400); status=await p.evaluate(()=>(window.Apollo.State||{}).status); if(status==='crashed'||status==='landed')break; }
  const verdict = await p.evaluate(()=>{
    const v=document.querySelector('.apollo-verdict');
    let fuelTxt=null; const rows=Array.from((v||document).querySelectorAll('.vd-stats span')); 
    // find FUEL REMAINING span
    const spans=Array.from((v||document).querySelectorAll('b')); 
    const fuelB=spans.find(b=>b.textContent==='FUEL REMAINING');
    fuelTxt = fuelB && fuelB.nextElementSibling ? fuelB.nextElementSibling.textContent : null;
    return { fuelTxt };
  });
  console.log('VERDICT_FUEL', JSON.stringify(verdict), 'status', status, 'MSGS', JSON.stringify(all));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
