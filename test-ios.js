const { chromium, devices } = require('playwright');
const http=require('http');const fs=require('fs');const path=require('path');
const ROOT=process.cwd();const mime={'.html':'text/html','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg'};
const s=http.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);const fp=path.join(ROOT,u==='/'?'index.html':u);fs.readFile(fp,(e,b)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':mime[path.extname(fp)]||'application/octet-stream'});r.end(b);});});

(async()=>{
  await new Promise(r=>s.listen(8796,'127.0.0.1',r));
  const b=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
  const ctx=await b.newContext({...devices['iPhone 12'], viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  const p=await ctx.newPage();
  const all=[];
  p.on('console',m=>all.push(m.type()+': '+m.text()));
  p.on('pageerror',e=>all.push('PAGEERROR: '+e.message));
  p.on('requestfailed',req=>all.push('REQFAIL: '+req.url()+' '+(req.failure()||{}).errorText));
  await p.goto('http://127.0.0.1:8796/index.html',{waitUntil:'networkidle',timeout:60000});
  await p.waitForTimeout(3000);
  const state = await p.evaluate(()=>{
    const boot=document.getElementById('boot');
    return {
      bootText: boot? (boot.textContent||'').trim():null,
      bootHidden: boot? boot.classList.contains('hidden'):null,
      apolloRoot: !!document.querySelector('.apollo-root'),
      menuShown: !!document.querySelector('.apollo-menu') && !document.querySelector('.apollo-menu').classList.contains('apollo-hidden'),
      canvas: !!document.querySelector('canvas'),
      economy: !!(window.Apollo&&window.Apollo.Economy),
      game: !!(window.Apollo&&window.Apollo.Game),
      bodyBg: getComputedStyle(document.body).backgroundColor
    };
  });
  console.log('STATE', JSON.stringify(state,null,2));
  console.log('ALL', JSON.stringify(all));
  await p.screenshot({path:'/tmp/ios-chromium.png'});
  await b.close();s.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
