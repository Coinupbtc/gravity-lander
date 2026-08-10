const { chromium, devices } = require('playwright');
(async()=>{
  const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const ctx=await b.newContext({...devices['iPhone 12'], viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  const p=await ctx.newPage();
  const errs=[];
  p.on('console',m=>{ if(['error','warning'].includes(m.type())) errs.push(m.type()+': '+m.text()); });
  p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  // Load from the ACTUAL LAN server (127.0.0.1 = same code path as 192.168.50.123)
  await p.goto('http://127.0.0.1:8070/index.html',{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(2500);
  const s=await p.evaluate(()=>{
    const boot=document.getElementById('boot');
    return {
      healthy: !!window.__healthy,
      errsCaptured: (window.__errs||[]).length,
      fatalShown: document.getElementById('fatal')? getComputedStyle(document.getElementById('fatal')).display!=='none':false,
      menuShown: !!document.querySelector('.apollo-menu') && !document.querySelector('.apollo-menu').classList.contains('apollo-hidden'),
      shopBtn: !!document.querySelector('[data-k=menuShop]'),
      wallet: (document.querySelector('[data-k=wal]')||{}).textContent,
      economy: !!(window.Apollo&&window.Apollo.Economy), game: !!(window.Apollo&&window.Apollo.Game),
      canvas: !!document.querySelector('canvas'), bootGone: !boot
    };
  });
  console.log('STATE', JSON.stringify(s,null,2));
  console.log('BROWSER_MSGS', JSON.stringify(errs));
  await p.screenshot({path:'/tmp/ios-lan.png'});
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
