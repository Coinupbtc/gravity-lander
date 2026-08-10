const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const p=await b.newPage({viewport:{width:1000,height:650}});
  const all=[]; p.on('pageerror',e=>all.push('PE '+e.message));
  await p.goto('http://127.0.0.1:8070/index.html',{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(1800);
  const read=()=>p.evaluate(()=>{
    const cv=document.querySelector('canvas'); const c=cv.getContext('2d');
    const d=c.getImageData(0,0,cv.width,cv.height).data; let r=0,g=0,b=0,n=0;
    for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
    return {r:(r/n/255).toFixed(3),g:(g/n/255).toFixed(3),b:(b/n/255).toFixed(3)};
  });
  // measure WITH sRGB (current, correct)
  const withSrgb = await read();
  // toggle renderer off the sRGB pipeline (linear) and force a re-render
  await p.evaluate(()=>{ const r=window.Apollo.Game._getRenderer(); r.outputEncoding = 3000; });
  await p.waitForTimeout(400);
  const withoutSrgb = await read();
  console.log('WITH_sRGB=', JSON.stringify(withSrgb));
  console.log('LINEAR   =', JSON.stringify(withoutSrgb));
  console.log('MSGS', JSON.stringify(all));
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
