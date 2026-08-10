/* =============================================================================
 * APOLLO DESCENT — UI / HUD module  (window.Apollo.UI)
 * -----------------------------------------------------------------------------
 * Pure DOM/CSS cockpit MFD overlay. No canvas text, no Three dependency —
 * only needs window.Apollo.State and window.Apollo.CFG.
 *
 * Layers (all absolute-positioned over a full-viewport root):
 *   .apollo-root          — fixed full-screen container (pointer-events:none)
 *   .apollo-telemetry     — top-left MFD readout panel
 *   .apollo-fuelbar       — vertical fuel gauge, thin track + segmented fill
 *   .apollo-tilt          — circular tilt/attitude indicator with horizon bar
 *   .apollo-reticle       — center-of-screen aiming/target reticle
 *   .apollo-vignette      — full-screen vignette + scanlines + subtle flicker
 *   .apollo-verdict       — full-screen SAFE LANDING / CRASHED overlay
 *   .apollo-menu          — full-screen title screen
 *
 * Deliberately self-contained: builds its own <style> so nothing outside this
 * file has to be edited.
 * ========================================================================== */

(function () {
  'use strict';

  // ---- Global namespace (safe create) -------------------------------------
  window.Apollo = window.Apollo || {};
  if (window.Apollo.UI) return; // already loaded — never double-init

  // ---- Style sheet (injected once) ----------------------------------------
  var CSS = [
    '.apollo-root{position:fixed;inset:0;overflow:hidden;pointer-events:none;'
      + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;z-index:9999;'
      + '-webkit-transform:translateZ(0);transform:translateZ(0);will-change:transform;'
      + 'font-family:\'Share Tech Mono\',\'Consolas\',\'Courier New\',monospace;}',
    '.apollo-root *{box-sizing:border-box;margin:0;padding:0;}',
    /* ---- glass MFD panel ---- */
    '.apollo-mfd{position:absolute;background:rgba(4,12,20,.55);'
      + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);'
      + 'border:1px solid rgba(0,229,255,.35);border-radius:6px;'
      + 'box-shadow:0 0 18px rgba(0,180,255,.15),inset 0 0 22px rgba(0,255,220,.05);}',
    '.apollo-mfd::before{content:\'\';position:absolute;inset:3px;'
      + 'border:1px solid rgba(0,255,230,.10);border-radius:4px;pointer-events:none;}',
    /* ---- telemetry panel ---- */
    '.apollo-telemetry{top:18px;left:18px;width:264px;padding:14px 16px 12px;}',
    '.apollo-tl-title{font-size:11px;letter-spacing:3px;color:rgba(0,229,255,.9);'
      + 'text-shadow:0 0 8px #00e5ff;border-bottom:1px solid rgba(0,229,255,.25);'
      + 'padding-bottom:6px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:baseline;}',
    '.apollo-tl-title .tick{color:rgba(255,255,255,.25);font-size:8px;letter-spacing:1px;}',
    '.apollo-row{display:flex;justify-content:space-between;align-items:baseline;'
      + 'font-size:12px;letter-spacing:1px;line-height:1.85;}',
    '.apollo-row .label{color:rgba(120,255,240,.55);font-size:9px;letter-spacing:2px;min-width:70px;}',
    '.apollo-row .value{color:#bffcff;text-shadow:0 0 6px rgba(0,255,255,.6);'
      + 'font-size:13px;font-weight:700;letter-spacing:1px;font-variant-numeric:tabular-nums;}',
    '.apollo-row.danger .value{color:#ff4d5e;text-shadow:0 0 8px rgba(255,60,84,.9);animation:apolloPulse 0.6s ease-in-out infinite;}',
    '.apollo-row.warn .value{color:#ffd166;text-shadow:0 0 8px rgba(255,200,60,.8);}',
    '.apollo-sep{height:1px;margin:6px 0;background:linear-gradient(90deg,'
      + 'rgba(0,229,255,.35),transparent);}',
    '.apollo-meter-wrap{display:flex;align-items:center;gap:8px;margin-top:4px;}',
    '.apollo-meter-label{color:rgba(120,255,240,.6);font-size:9px;letter-spacing:2px;min-width:70px;}',
    '.apollo-meter{flex:1;height:8px;background:rgba(0,40,60,.6);border:1px solid rgba(0,229,255,.3);'
      + 'border-radius:4px;overflow:hidden;}',
    '.apollo-meter-fill{height:100%;width:0%;background:linear-gradient(90deg,#00e5ff,#00ff9d);'
      + 'box-shadow:0 0 10px rgba(0,255,180,.8);transition:width .05s linear;}',
    '.apollo-meter-fill.low{background:linear-gradient(90deg,#ff4d5e,#ff8a00);'
      + 'box-shadow:0 0 10px rgba(255,80,90,.9);animation:apolloPulse 0.5s ease-in-out infinite;}',
    /* ---- fuel bar (thin vertical) ---- */
    '.apollo-fuelbar{top:18px;left:300px;width:150px;padding:10px 12px;}',
    '.apollo-fuelbar .fb-title{font-size:9px;letter-spacing:2px;color:rgba(120,255,240,.6);'
      + 'margin-bottom:6px;text-align:center;text-shadow:0 0 6px rgba(0,255,180,.3);}',
    '.apollo-fuelbar .fb-track{position:relative;height:14px;background:rgba(0,30,45,.7);'
      + 'border:1px solid rgba(0,229,255,.3);border-radius:3px;overflow:hidden;}',
    '.apollo-fuelbar .fb-fill{position:absolute;left:0;top:0;bottom:0;width:100%;'
      + 'background:repeating-linear-gradient(90deg,#00ff9d 0 8px,#00e5ff 8px 10px);'
      + 'box-shadow:0 0 12px rgba(0,255,150,.7);}',
    '.apollo-fuelbar .fb-fill.low{background:repeating-linear-gradient(90deg,#ff4d5e 0 8px,#ff8a00 8px 10px);'
      + 'box-shadow:0 0 12px rgba(255,80,90,.8);animation:apolloPulse 0.5s ease-in-out infinite;}',
    '.apollo-fuelbar .fb-num{text-align:center;color:#bffcff;font-size:13px;font-weight:700;'
      + 'text-shadow:0 0 8px rgba(0,255,255,.6);margin-top:4px;letter-spacing:1px;}',
    /* ---- tilt / attitude indicator (+ dual X/Z graphs) ---- */
    '.apollo-tilt{top:18px;right:18px;width:124px;height:168px;padding:8px;}',
    '.apollo-tilt svg{width:100%;height:92px;display:block;}',
    '.apollo-tilt .ti-title{color:rgba(120,255,240,.6);font-size:8px;letter-spacing:2px;'
      + 'text-align:center;margin-top:-4px;margin-bottom:2px;}',
    '.apollo-tilt .ti-graphs{display:flex;gap:8px;margin-top:4px;align-items:flex-end;'
      + 'justify-content:center;}',
    '.apollo-tilt .ti-g{flex:1;min-width:0;}',
    '.apollo-tilt .ti-g-lab{font-size:7px;letter-spacing:1px;color:rgba(120,255,240,.55);'
      + 'text-align:center;margin-bottom:3px;}',
    '.apollo-tilt .ti-g-track{position:relative;background:rgba(0,40,60,.55);'
      + 'border:1px solid rgba(0,229,255,.28);border-radius:2px;overflow:hidden;}',
    '.apollo-tilt .ti-g-h{height:10px;width:100%;}',
    '.apollo-tilt .ti-g-v{height:36px;width:14px;margin:0 auto;}',
    '.apollo-tilt .ti-g-mark{position:absolute;background:#35ff9e;'
      + 'box-shadow:0 0 6px rgba(53,255,158,.85);border-radius:1px;}',
    '.apollo-tilt .ti-g-h .ti-g-mark{top:1px;bottom:1px;width:3px;left:50%;margin-left:-1.5px;}',
    '.apollo-tilt .ti-g-v .ti-g-mark{left:1px;right:1px;height:3px;top:50%;margin-top:-1.5px;}',
    /* ---- center reticle ---- */
    '.apollo-reticle{position:absolute;left:50%;top:50%;width:180px;height:180px;'
      + 'transform:translate(-50%,-50%);pointer-events:none;opacity:.85;}',
    '.apollo-reticle .ret-circle{position:absolute;left:50%;top:50%;width:56px;height:56px;'
      + 'transform:translate(-50%,-50%);border:1px solid rgba(0,229,255,.5);border-radius:50%;'
      + 'box-shadow:0 0 12px rgba(0,229,255,.25);}',
    '.apollo-reticle .ret-circle:after{content:\'\';position:absolute;inset:6px;'
      + 'border:1px dashed rgba(0,229,255,.28);border-radius:50%;}',
    '.apollo-reticle .ret-x{position:absolute;left:50%;top:50%;}',
    '.apollo-reticle .ret-x i{position:absolute;background:rgba(0,229,255,.6);'
      + 'box-shadow:0 0 8px rgba(0,229,255,.6);}',
    /* Phone media query lives at END of stylesheet (after base menu/HUD rules)
       so overrides win cascade. See PHONE_MQ block below. */
    '.apollo-reticle .ret-x .h{width:34px;height:1px;top:-0.5px;left:-17px;}',
    '.apollo-reticle .ret-x .v{width:1px;height:34px;left:-0.5px;top:-17px;}',
    '.apollo-reticle .ret-tick{position:absolute;width:2px;height:7px;background:rgba(0,255,180,.5);}',
    '.apollo-reticle .ret-ring{position:absolute;left:50%;top:50%;width:150px;height:150px;'
      + 'transform:translate(-50%,-50%);border:1px solid rgba(0,255,180,.15);border-radius:50%;}',
    /* ---- right touchpoints: status + timer ---- */
    '.apollo-status{top:18px;right:18px;transform:translateY(190px);width:150px;padding:10px 12px;'
      + 'text-align:center;}',
    '.apollo-status .st-main{font-size:16px;font-weight:700;letter-spacing:3px;color:#bffcff;'
      + 'text-shadow:0 0 10px rgba(0,255,255,.7);}',
    '.apollo-status .st-sub{font-size:9px;letter-spacing:2px;color:rgba(120,255,240,.55);margin-top:4px;}',
    '.apollo-watch{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:8px 12px;text-align:center;}',
    '.apollo-watch .wk{font-size:10px;letter-spacing:2px;color:rgba(120,255,240,.55);}',
    '.apollo-watch .wv{font-size:16px;font-weight:700;color:#bffcff;text-shadow:0 0 8px rgba(0,255,255,.6);}',
    /* ---- vignette + scanlines ---- */
    '.apollo-vignette{position:absolute;inset:0;pointer-events:none;'
      + 'background:radial-gradient(ellipse at center,transparent 52%,rgba(0,0,0,.55) 100%);}',
    '.apollo-vignette::after{content:\'\';position:absolute;inset:0;'
      + 'background:repeating-linear-gradient(0deg,rgba(180,255,255,.025) 0 1px,transparent 1px 3px);}',
    /* ---- shared animations ---- */
    '@keyframes apolloPulse{0%,100%{opacity:1}50%{opacity:.5}}',
    '@keyframes apolloFlicker{0%,100%{opacity:.96}8%{opacity:.88}10%{opacity:.97}'
      + '46%{opacity:.91}47%{opacity:.98}75%{opacity:.9}}',
    /* ---- verdict overlay ---- */
    '.apollo-verdict{position:absolute;inset:0;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;pointer-events:none;'
      + 'background:radial-gradient(ellipse at center,rgba(0,10,18,.35),rgba(0,0,0,.78));'
      + 'opacity:0;transition:opacity .6s ease;}',
    '.apollo-verdict.show{opacity:1;pointer-events:auto;}',
    '.apollo-verdict .vd-title{font-size:64px;font-weight:700;letter-spacing:.35em;'
      + 'text-indent:.35em;text-shadow:0 0 30px currentColor;}',
    '.apollo-verdict .vd-sub{font-size:14px;letter-spacing:6px;color:rgba(255,255,255,.55);'
      + 'margin-top:8px;}',
    '.apollo-verdict .vd-stats{margin-top:26px;display:grid;grid-template-columns:auto auto;'
      + 'gap:6px 22px;font-size:13px;color:rgba(255,255,255,.85);}',
    '.apollo-verdict .vd-stats b{text-align:right;color:rgba(255,255,255,.45);font-weight:400;'
      + 'letter-spacing:1px;}',
    '.apollo-verdict .vd-stats span{text-align:left;font-weight:700;letter-spacing:1px;}',
    '.apollo-verdict .vd-cmd{margin-top:34px;font-size:12px;letter-spacing:4px;'
      + 'color:rgba(255,255,255,.5);animation:apolloPulse 1.1s ease-in-out infinite;}',
    '.apollo-verdict.good .vd-title{color:#35ff9e;}',
    '.apollo-verdict.good .vd-cmd{color:rgba(53,255,158,.7);}',
    '.apollo-verdict.bad .vd-title{color:#ff4d5e;animation:apolloPulse .5s ease-in-out infinite;}',
    '.apollo-verdict.bad .vd-cmd{color:rgba(255,77,94,.7);}',
    '.apollo-verdict .vd-replay{margin-top:36px;pointer-events:auto;cursor:pointer;'
      + 'font-family:inherit;font-size:20px;letter-spacing:6px;padding:16px 48px 16px 54px;'
      + 'color:#d6fbff;background:rgba(0,60,90,.5);border:1px solid rgba(0,229,255,.7);'
      + 'border-radius:4px;text-shadow:0 0 12px rgba(0,229,255,.8);'
      + 'box-shadow:0 0 28px rgba(0,229,255,.35),inset 0 0 20px rgba(0,229,255,.2);'
      + 'transition:all .18s ease;touch-action:none;-webkit-touch-callout:none;'
      + 'user-select:none;-webkit-user-select:none;min-width:220px;}',
    '.apollo-verdict .vd-replay:active{transform:scale(.96);background:rgba(0,90,130,.7);'
      + 'box-shadow:0 0 40px rgba(0,229,255,.6),inset 0 0 26px rgba(0,229,255,.35);}',
    '.apollo-verdict.show .vd-replay{pointer-events:auto;}'
    ,
    /* ---- title menu (desktop base; phone overrides in PHONE_MQ at end) ---- */
    '.apollo-menu{position:absolute;inset:0;display:flex;flex-direction:column;'
      + 'align-items:center;justify-content:center;pointer-events:auto;z-index:30;'
      + 'padding:24px 20px;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;'
      + 'background:radial-gradient(ellipse at center,rgba(0,14,24,.55),rgba(0,0,0,.88));'
      + 'box-sizing:border-box;}',
    '.apollo-menu .mn-card{width:min(520px,100%);max-width:100%;display:flex;flex-direction:column;'
      + 'align-items:center;text-align:center;box-sizing:border-box;}',
    '.apollo-menu .mn-kicker{font-size:12px;letter-spacing:6px;color:rgba(0,229,255,.75);'
      + 'text-shadow:0 0 10px rgba(0,229,255,.6);margin-bottom:10px;max-width:100%;}',
    '.apollo-menu .mn-title{font-size:clamp(36px,7vw,72px);font-weight:700;letter-spacing:.12em;'
      + 'line-height:1.05;max-width:100%;color:#d6fbff;'
      + 'text-shadow:0 0 20px rgba(0,229,255,.6),0 0 60px rgba(0,229,255,.35);}',
    '.apollo-menu .mn-sub{font-size:clamp(12px,2.5vw,18px);letter-spacing:.25em;'
      + 'color:rgba(120,255,240,.75);text-shadow:0 0 12px rgba(0,255,180,.5);margin-top:10px;'
      + 'max-width:100%;}',
    '.apollo-menu .mn-objective{margin-top:16px;font-size:14px;color:rgba(255,255,255,.88);'
      + 'letter-spacing:0.5px;line-height:1.55;text-align:center;max-width:min(440px,100%);'
      + 'padding:0 4px;box-sizing:border-box;}',
    '.apollo-menu .mn-hint{margin-top:12px;font-size:11px;color:rgba(255,214,120,.85);'
      + 'letter-spacing:1px;text-align:center;max-width:min(420px,100%);padding:0 6px;}',
    '.apollo-menu .mn-div{width:min(420px,88%);height:1px;margin:20px 0;'
      + 'background:linear-gradient(90deg,transparent,rgba(0,229,255,.6),transparent);}',
    '.apollo-menu .mn-controls{font-size:13px;color:rgba(255,255,255,.72);letter-spacing:1px;'
      + 'line-height:1.9;text-align:left;width:min(360px,100%);max-width:100%;box-sizing:border-box;}',
    '.apollo-menu .mn-controls b{color:#bffcff;text-shadow:0 0 8px rgba(0,255,255,.6);'
      + 'font-weight:700;}',
    '.apollo-menu .mn-controls span{color:rgba(120,255,240,.6);letter-spacing:1px;}',
    '.apollo-menu .mn-start{margin-top:22px;pointer-events:auto;cursor:pointer;'
      + 'font-family:inherit;font-size:16px;letter-spacing:3px;padding:14px 28px;'
      + 'min-height:48px;width:min(340px,100%);max-width:100%;box-sizing:border-box;'
      + 'color:#d6fbff;background:rgba(0,40,60,.4);border:1px solid rgba(0,229,255,.55);'
      + 'border-radius:4px;text-shadow:0 0 10px rgba(0,229,255,.7);'
      + 'box-shadow:0 0 24px rgba(0,229,255,.25),inset 0 0 18px rgba(0,229,255,.15);'
      + 'transition:all .18s ease;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
    '.apollo-menu .mn-start:hover{background:rgba(0,70,95,.6);'
      + 'box-shadow:0 0 40px rgba(0,229,255,.5),inset 0 0 26px rgba(0,229,255,.3);'
      + 'transform:translateY(-2px);}',
    '.apollo-menu .mn-start:active{transform:translateY(0);}',
    '.apollo-menu .mn-shop{margin-top:12px;font-size:13px;padding:12px 20px;letter-spacing:2px;'
      + 'border-color:rgba(255,214,120,.5);color:#ffe9b0;text-shadow:0 0 10px rgba(255,200,80,.6);'
      + 'background:rgba(40,30,4,.35);box-shadow:0 0 18px rgba(255,190,60,.15);}'
    + '.apollo-menu .mn-shop:hover{background:rgba(70,54,8,.55);box-shadow:0 0 30px rgba(255,200,80,.35);}',
    '.apollo-menu .mn-foot{margin-top:18px;font-size:9px;letter-spacing:2px;color:rgba(255,255,255,.3);'
      + 'max-width:100%;padding:0 8px;}',
    /* Hide play HUD while title/shop overlays own the screen */
    '.apollo-root.menu-mode .apollo-telemetry,'
      + '.apollo-root.menu-mode .apollo-fuelbar,'
      + '.apollo-root.menu-mode .apollo-tilt,'
      + '.apollo-root.menu-mode .apollo-reticle,'
      + '.apollo-root.menu-mode .apollo-status,'
      + '.apollo-root.menu-mode .apollo-watch,'
      + '.apollo-root.menu-mode .apollo-touch,'
      + '.apollo-root.menu-mode .apollo-env{display:none !important;}',
    /* Wallet chip: corner in menu so it does not sit on the title */
    '.apollo-root.menu-mode .apollo-wallet{top:max(10px,env(safe-area-inset-top));'
      + 'left:auto;right:max(10px,env(safe-area-inset-right));transform:none;z-index:35;}',
    /* ---- dual-stick multi-touch: LEFT 360° AIM · RIGHT vertical BOOST ---- */
    '.apollo-touch{position:absolute;bottom:max(18px,env(safe-area-inset-bottom));'
      + 'pointer-events:auto;opacity:0;transition:opacity .25s ease;touch-action:none;'
      + '-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;'
      + '-webkit-transform:translateZ(0);transform:translateZ(0);will-change:opacity;'
      + 'z-index:40;}',
    /* Square AIM pad — full 360° stick (not a horizontal-only bar) */
    '.apollo-touch-l{left:max(10px,env(safe-area-inset-left));width:132px;height:132px;}',
    /* Tall vertical BOOST slider */
    '.apollo-touch-r{right:max(10px,env(safe-area-inset-right));width:64px;height:168px;}',
    '.apollo-touch.show{opacity:1;}',
    '.apollo-tilt-stick{position:relative;width:100%;height:100%;border-radius:50%;'
      + 'border:2px solid rgba(0,229,255,.55);background:rgba(0,30,45,.58);'
      + 'pointer-events:auto;touch-action:none;box-shadow:0 0 18px rgba(0,180,255,.22);'
      + 'backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);'
      + 'touch-action:none;}',
    '.apollo-tilt-stick.pressed{border-color:#00e5ff;box-shadow:0 0 24px rgba(0,229,255,.5);'
      + 'background:rgba(0,50,75,.72);}',
    '.apollo-tilt-stick .ts-label{position:absolute;top:10px;left:0;right:0;text-align:center;'
      + 'font-size:10px;letter-spacing:2px;color:rgba(120,255,240,.7);pointer-events:none;}',
    '.apollo-tilt-stick .ts-hint{position:absolute;bottom:10px;left:0;right:0;text-align:center;'
      + 'font-size:8px;letter-spacing:1px;color:rgba(120,255,240,.4);pointer-events:none;}',
    '.apollo-tilt-stick .ts-cross{position:absolute;inset:18%;border-radius:50%;'
      + 'border:1px dashed rgba(0,229,255,.2);pointer-events:none;}',
    '.apollo-tilt-stick .ts-knob{position:absolute;left:50%;top:50%;width:40px;height:40px;'
      + 'margin:-20px 0 0 -20px;border-radius:50%;background:rgba(0,229,255,.4);'
      + 'border:2px solid rgba(0,229,255,.9);box-shadow:0 0 14px rgba(0,229,255,.55);'
      + 'pointer-events:none;will-change:transform;}',
    '.apollo-thr-slider{position:relative;width:100%;height:100%;border-radius:32px;'
      + 'border:2px solid rgba(255,180,80,.6);background:rgba(40,22,5,.58);'
      + 'pointer-events:auto;touch-action:none;overflow:hidden;'
      + 'box-shadow:0 0 18px rgba(255,160,40,.22);}',
    '.apollo-thr-slider.pressed{border-color:#ffc77a;box-shadow:0 0 26px rgba(255,180,60,.5);}',
    '.apollo-thr-slider .thr-fill{position:absolute;left:0;right:0;bottom:0;height:0%;'
      + 'background:linear-gradient(0deg,#ff8a00,#ffd166);box-shadow:0 0 16px rgba(255,180,60,.65);'
      + 'pointer-events:none;}',
    '.apollo-thr-slider .thr-label{position:absolute;inset:0;display:flex;align-items:center;'
      + 'justify-content:center;writing-mode:vertical-rl;transform:rotate(180deg);'
      + 'font-size:12px;letter-spacing:3px;color:#ffe0a8;pointer-events:none;'
      + 'text-shadow:0 0 8px rgba(255,180,60,.65);}',
    '.apollo-env{position:absolute;left:50%;bottom:max(190px,calc(env(safe-area-inset-bottom)+170px));'
      + 'transform:translateX(-50%);display:flex;gap:8px;pointer-events:none;z-index:4;opacity:0;}',
    '.apollo-env.show{opacity:1;}',
    '.apollo-env .env-pip{min-width:54px;padding:5px 8px;border-radius:4px;text-align:center;'
      + 'font-size:9px;letter-spacing:1px;border:1px solid rgba(0,229,255,.3);'
      + 'background:rgba(0,20,30,.55);color:#9ff;}',
    '.apollo-env .env-pip.green{border-color:rgba(53,255,158,.55);color:#9fffcb;}',
    '.apollo-env .env-pip.amber{border-color:rgba(255,200,80,.6);color:#ffd166;}',
    '.apollo-env .env-pip.red{border-color:rgba(255,77,94,.7);color:#ff8a96;'
      + 'animation:apolloPulse .5s ease-in-out infinite;}',
    /* Low-altitude PULL-UP warning banner (freegle idea #4) */
    '.apollo-prox{position:absolute;top:max(92px,calc(env(safe-area-inset-top)+84px));'
      + 'left:50%;transform:translateX(-50%);pointer-events:none;z-index:6;'
      + 'text-align:center;background:rgba(40,6,10,.6);border:2px solid #ff4d5e;'
      + 'border-radius:6px;padding:10px 18px;'
      + 'box-shadow:0 0 30px rgba(255,60,80,.7),inset 0 0 24px rgba(255,60,80,.25);}'
    + '.apollo-prox .px-main{font-size:26px;font-weight:700;letter-spacing:6px;color:#ff4d5e;'
      + 'text-shadow:0 0 18px rgba(255,60,80,.9);animation:apolloPulse .5s ease-in-out infinite;}'
    + '.apollo-prox .px-sub{font-size:10px;letter-spacing:2px;color:#ffc2c8;margin-top:3px;}'
    + '.apollo-prox .px-alt{font-size:16px;letter-spacing:2px;color:#ffe0e2;margin-top:4px;'
      + 'font-variant-numeric:tabular-nums;}',
    '.apollo-menu .mn-lv{font-size:11px;letter-spacing:2px;color:#ffd166;margin-bottom:8px;text-align:center;}',
    '.apollo-menu .mn-planets{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-bottom:8px;}',
    '.apollo-menu .mn-pbtn{pointer-events:auto;cursor:pointer;font-family:inherit;font-size:10px;'
      + 'letter-spacing:1px;padding:8px 10px;border-radius:4px;border:1px solid rgba(0,229,255,.4);'
      + 'background:rgba(0,40,60,.45);color:#bffcff;min-height:40px;}',
    '.apollo-menu .mn-pbtn.on{border-color:#35ff9e;background:rgba(20,70,50,.55);color:#9fffcb;}',
    '.apollo-menu .mn-pbtn.locked{opacity:.4;color:#888;}',
    '.apollo-menu .mn-pads{display:flex;flex-direction:column;gap:6px;max-height:150px;overflow-y:auto;align-self:stretch;width:100%;}',
    '.apollo-menu .mn-pad{pointer-events:auto;cursor:pointer;font-family:inherit;text-align:left;'
      + 'padding:10px 12px;width:100%;box-sizing:border-box;border-radius:4px;border:1px solid rgba(0,229,255,.28);'
      + 'background:rgba(0,30,45,.4);color:#d6fbff;font-size:12px;}',
    '.apollo-menu .mn-pad.on{border-color:#ffd166;background:rgba(70,50,10,.4);}',
    '.apollo-menu .mn-pad .pd-meta{font-size:10px;color:rgba(120,255,240,.65);margin-top:3px;line-height:1.5;overflow-wrap:break-word;}',
    '.apollo-verdict .vd-grade{margin-top:12px;font-size:48px;font-weight:700;letter-spacing:6px;'
      + 'color:#ffd166;text-shadow:0 0 24px rgba(255,200,80,.85);}',
    '.apollo-verdict .vd-grade-sub{font-size:12px;letter-spacing:3px;color:rgba(255,214,120,.75);margin-top:4px;}',
    '.apollo-verdict .vd-stars{font-size:18px;letter-spacing:4px;color:#ffd166;margin-top:4px;}'
    + '.apollo-verdict .vd-flourish{margin-top:8px;font-size:12px;letter-spacing:3px;color:#9fffcb;'
      + 'text-shadow:0 0 14px rgba(53,255,158,.85);}',
    '.apollo-verdict .vd-xp{margin-top:8px;font-size:12px;letter-spacing:2px;color:#9fffcb;}',
    /* ---- wallet chip (top-centre) ---- */
    '.apollo-wallet{position:absolute;top:18px;left:50%;transform:translateX(-50%);'
      + 'padding:8px 20px;display:flex;align-items:center;gap:8px;'
      + 'border:1px solid rgba(255,214,120,.4);border-radius:4px;'
      + 'background:rgba(24,18,6,.5);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);'
      + 'box-shadow:0 0 18px rgba(255,190,60,.18),inset 0 0 16px rgba(255,200,80,.06);}'
    + '.apollo-wallet .w-ic{font-size:13px;letter-spacing:2px;color:#ffd166;'
      + 'text-shadow:0 0 8px rgba(255,200,80,.8);}'
    + '.apollo-wallet .w-bal{font-size:16px;font-weight:700;color:#ffe9b0;'
      + 'text-shadow:0 0 10px rgba(255,210,120,.7);font-variant-numeric:tabular-nums;}'
    + '.apollo-wallet .w-btn{pointer-events:auto;cursor:pointer;border:1px solid rgba(0,229,255,.5);'
      + 'background:rgba(0,60,90,.55);color:#bffcff;font-family:inherit;font-size:10px;'
      + 'letter-spacing:3px;padding:6px 12px;border-radius:3px;transition:all .15s ease;'
      + 'text-shadow:0 0 8px rgba(0,229,255,.7);}'
    + '.apollo-wallet .w-btn:hover{background:rgba(0,90,130,.75);box-shadow:0 0 20px rgba(0,229,255,.4);}'
    + '.apollo-wallet .w-btn:active{transform:scale(.95);}'
    /* ---- SHOP overlay (scrollable card + sticky close — fits phone both ways) ---- */
    + '.apollo-shop{position:absolute;inset:0;display:flex;align-items:stretch;justify-content:center;'
      + 'pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,12,20,.55),rgba(0,0,0,.88));'
      + 'opacity:0;transition:opacity .25s ease;z-index:40;'
      + 'padding:max(10px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) '
      + 'max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));'
      + 'box-sizing:border-box;}'
    + '.apollo-shop.show{opacity:1;pointer-events:auto;}'
    + '.apollo-shop-inner{width:min(500px,100%);max-height:100%;overflow:auto;-webkit-overflow-scrolling:touch;'
      + 'background:rgba(5,14,24,.95);border:1px solid rgba(0,229,255,.45);border-radius:8px;'
      + 'padding:12px 14px 18px;box-shadow:0 0 40px rgba(0,180,255,.25),inset 0 0 30px rgba(0,255,220,.05);'
      + 'display:flex;flex-direction:column;}'
    + '.apollo-shop .sp-top{position:sticky;top:0;z-index:2;background:rgba(5,14,24,.97);'
      + 'padding-bottom:8px;margin:0 -2px 8px;border-bottom:1px solid rgba(0,229,255,.2);}'
    + '.apollo-shop .sp-close-top{display:block;width:100%;cursor:pointer;font-family:inherit;'
      + 'font-size:12px;letter-spacing:3px;padding:12px;min-height:44px;margin-bottom:8px;'
      + 'color:#d6fbff;border:1px solid rgba(0,229,255,.65);border-radius:4px;'
      + 'background:rgba(0,50,75,.65);text-shadow:0 0 10px rgba(0,229,255,.7);touch-action:manipulation;}'
    + '.apollo-shop h2{font-size:18px;letter-spacing:4px;text-indent:0;color:#d6fbff;'
      + 'text-shadow:0 0 16px rgba(0,229,255,.7);text-align:center;margin-bottom:4px;}'
    + '.apollo-shop .sp-sub{font-size:10px;letter-spacing:2px;color:rgba(120,255,240,.6);'
      + 'text-align:center;margin-bottom:8px;}'
    + '.apollo-shop .sp-bal{text-align:center;font-size:14px;color:#ffd166;margin-bottom:10px;'
      + 'text-shadow:0 0 10px rgba(255,200,80,.6);letter-spacing:2px;}'
    + '.apollo-shop .sp-item{border:1px solid rgba(0,229,255,.22);border-radius:6px;padding:10px 12px;'
      + 'margin-bottom:10px;background:rgba(0,30,45,.35);}'
    + '.apollo-shop .sp-item-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;}'
    + '.apollo-shop .sp-name{font-size:14px;font-weight:700;letter-spacing:2px;color:#bffcff;'
      + 'text-shadow:0 0 8px rgba(0,255,255,.5);}'
    + '.apollo-shop .sp-lv{font-size:10px;color:rgba(255,214,120,.85);letter-spacing:1px;}'
    + '.apollo-shop .sp-desc{font-size:11px;color:rgba(255,255,255,.7);line-height:1.45;'
      + 'margin:6px 0 10px;white-space:pre-line;}'
    + '.apollo-shop .sp-tank{height:8px;background:rgba(0,40,60,.7);border:1px solid rgba(0,229,255,.3);'
      + 'border-radius:4px;overflow:hidden;margin-bottom:10px;}'
    + '.apollo-shop .sp-tank-fill{height:100%;background:linear-gradient(90deg,#00e5ff,#00ff9d);'
      + 'box-shadow:0 0 10px rgba(0,255,180,.7);transition:width .4s ease;}'
    + '.apollo-shop .sp-buy{display:block;width:100%;cursor:pointer;font-family:inherit;'
      + 'font-size:13px;letter-spacing:3px;padding:12px;min-height:44px;border-radius:4px;'
      + 'color:#f3ffd8;border:1px solid rgba(255,214,120,.6);background:rgba(90,70,10,.5);'
      + 'text-shadow:0 0 10px rgba(255,200,80,.6);box-shadow:0 0 18px rgba(255,190,60,.18);'
      + 'transition:all .15s ease;touch-action:manipulation;}'
    + '.apollo-shop .sp-buy:hover{background:rgba(120,95,14,.7);box-shadow:0 0 26px rgba(255,200,80,.35);}'
    + '.apollo-shop .sp-buy:active{transform:scale(.98);}'
    + '.apollo-shop .sp-buy:disabled{opacity:.45;cursor:not-allowed;box-shadow:none;}'  
    + '.apollo-shop .sp-buy.maxed{opacity:.6;color:#9fffcb;border-color:rgba(53,255,158,.5);'
      + 'background:rgba(20,70,40,.4);}'
    + '.apollo-shop .sp-refuel{margin-top:4px;padding-top:12px;border-top:1px solid rgba(0,229,255,.2);}'
    + '.apollo-shop .sp-refuel-row{display:flex;align-items:center;gap:12px;}'
    + '.apollo-shop .rf-track{flex:1;height:12px;background:rgba(0,40,60,.7);'
      + 'border:1px solid rgba(0,229,255,.35);border-radius:4px;overflow:hidden;}'
    + '.apollo-shop .rf-fill{height:100%;width:0%;background:repeating-linear-gradient(90deg,#00ff9d 0 8px,#00e5ff 8px 10px);'
      + 'box-shadow:0 0 12px rgba(0,255,150,.7);transition:width .1s linear;}'
    + '.apollo-shop .rf-lbl{font-size:11px;color:rgba(120,255,240,.75);letter-spacing:2px;min-width:96px;}'
    + '.apollo-shop .sp-close{margin-top:12px;display:block;width:100%;cursor:pointer;'
      + 'font-family:inherit;font-size:13px;letter-spacing:4px;padding:12px;min-height:44px;'
      + 'color:#d6fbff;border:1px solid rgba(0,229,255,.6);border-radius:4px;'
      + 'background:rgba(0,50,75,.5);text-shadow:0 0 10px rgba(0,229,255,.7);'
      + 'transition:all .15s ease;touch-action:manipulation;}'
    + '.apollo-shop .sp-close:hover{background:rgba(0,80,115,.7);}'
    /* ---- controller options (main menu) ---- */
    + '.apollo-menu .mn-opts{margin-top:10px;border:1px solid rgba(0,229,255,.28);border-radius:6px;'
      + 'padding:10px 12px;background:rgba(0,30,45,.4);text-align:left;}'
    + '.apollo-menu .mn-opts-title{font-size:10px;letter-spacing:2px;color:rgba(120,255,240,.7);'
      + 'margin-bottom:8px;text-align:center;}'
    + '.apollo-menu .mn-opt-row{display:flex;align-items:center;justify-content:space-between;gap:10px;'
      + 'margin-bottom:8px;font-size:12px;color:#d6fbff;}'
    + '.apollo-menu .mn-opt-row label{flex:1;letter-spacing:1px;}'
    + '.apollo-menu .mn-tog{min-width:52px;min-height:40px;padding:8px 10px;border-radius:4px;'
      + 'border:1px solid rgba(0,229,255,.45);background:rgba(0,40,60,.5);color:#9fd8ff;'
      + 'font-family:inherit;font-size:11px;letter-spacing:1px;pointer-events:auto;cursor:pointer;'
      + 'touch-action:manipulation;}'
    + '.apollo-menu .mn-tog.on{border-color:#35ff9e;background:rgba(20,70,50,.55);color:#9fffcb;}'
    + '.apollo-menu .mn-sens{width:100%;accent-color:#00e5ff;}'
    + '.apollo-menu .mn-sens-val{font-size:11px;color:#ffd166;min-width:36px;text-align:right;}'
    + '.apollo-verdict .vd-actions{display:flex;flex-direction:column;gap:10px;width:min(320px,90%);'
      + 'margin-top:22px;align-items:stretch;}'
    + '.apollo-verdict .vd-hangar{pointer-events:auto;cursor:pointer;font-family:inherit;'
      + 'font-size:13px;letter-spacing:2px;padding:12px;min-height:44px;border-radius:4px;'
      + 'color:#ffe9b0;border:1px solid rgba(255,214,120,.55);background:rgba(70,50,10,.55);'
      + 'touch-action:manipulation;}'
    + '.apollo-verdict .vd-menu{pointer-events:auto;cursor:pointer;font-family:inherit;'
      + 'font-size:13px;letter-spacing:2px;padding:12px;min-height:44px;border-radius:4px;'
      + 'color:#d6fbff;border:1px solid rgba(0,229,255,.55);background:rgba(0,40,60,.55);'
      + 'touch-action:manipulation;}'
    + '.apollo-verdict .vd-why{margin-top:10px;font-size:12px;letter-spacing:1px;line-height:1.4;'
      + 'color:#ff8a96;max-width:92%;text-align:center;}'
    + '.apollo-wallet .w-btn.shop-locked{opacity:.35;pointer-events:none;}'
    /* ---- verdict reward + refuel beat ---- */
    + '.apollo-verdict .vd-pay{margin-top:20px;font-size:26px;font-weight:700;letter-spacing:3px;'
      + 'color:#ffd166;text-shadow:0 0 18px rgba(255,200,80,.8);}'
    + '.apollo-verdict .vd-pay.sub{font-size:12px;letter-spacing:2px;color:rgba(255,214,120,.7);margin-top:6px;}'
    + '.apollo-verdict .vd-graze{margin-top:8px;font-size:11px;letter-spacing:2px;color:#9fffcb;'
      + 'text-shadow:0 0 10px rgba(53,255,158,.7);}'
    + '.apollo-verdict .vd-refuel{margin-top:14px;width:240px;height:10px;'
      + 'background:rgba(0,40,60,.7);border:1px solid rgba(0,229,255,.35);'
      + 'border-radius:5px;overflow:hidden;}'
    + '.apollo-verdict .vd-refuel .rf-fill{height:100%;width:0%;'
      + 'background:repeating-linear-gradient(90deg,#00ff9d 0 8px,#00e5ff 8px 10px);'
      + 'box-shadow:0 0 12px rgba(0,255,150,.8);}'
    + '.apollo-verdict .vd-refuel .rf-fill.busy{animation:none;transition:none;}'
    + '.apollo-hidden{display:none !important;}'
    /* ========== PHONE_MQ: MUST be last so it beats desktop base rules ==========
       Bug fixed 2026-08-09: earlier max-width block sat BEFORE .mn-title{78px}
       so iPhone still got desktop title (~481px wide) and off-frame menu. */
    + '@media (max-width:480px){'
      + '.apollo-telemetry{top:max(10px,env(safe-area-inset-top));left:8px;'
      +   'width:min(200px,54vw);padding:8px 10px;}'
      + '.apollo-fuelbar{left:8px;top:auto;bottom:max(110px,calc(env(safe-area-inset-bottom)+96px));'
      +   'width:88px;padding:8px 8px;}'
      + '.apollo-tilt{right:8px;top:max(10px,env(safe-area-inset-top));width:88px;height:128px;padding:4px;}'
      + '.apollo-tilt svg{height:64px;}'
      + '.apollo-tilt .ti-g-v{height:28px;width:12px;}'
      + '.apollo-status{right:8px;width:100px;top:max(10px,env(safe-area-inset-top));'
      +   'transform:translateY(138px);padding:6px 6px;}'
      + '.apollo-status .st-main{font-size:12px;letter-spacing:1px;}'
      + '.apollo-watch{bottom:auto;top:max(10px,env(safe-area-inset-top));left:50%;'
      +   'transform:translateX(-50%);padding:5px 8px;z-index:2;}'
      + '.apollo-wallet{top:max(8px,env(safe-area-inset-top));padding:5px 10px;}'
      + '.apollo-wallet .w-bal{font-size:13px;}'
      /* Title menu — fit 390×844 / Safari visual viewport */
      + '.apollo-menu{justify-content:flex-start;align-items:stretch;'
      +   'padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) '
      +   'max(16px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));'
      +   'overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;}'
      + '.apollo-menu .mn-card{width:100%;max-width:100%;flex:0 0 auto;padding:8px 0 12px;}'
      + '.apollo-menu .mn-kicker{font-size:9px;letter-spacing:3px;margin-bottom:6px;}'
      + '.apollo-menu .mn-title{font-size:clamp(28px,11vw,36px);letter-spacing:.06em;'
      +   'line-height:1.08;max-width:100%;}'
      + '.apollo-menu .mn-sub{font-size:11px;letter-spacing:.18em;margin-top:6px;}'
      + '.apollo-menu .mn-objective{margin-top:10px;font-size:12px;line-height:1.45;'
      +   'max-width:100%;letter-spacing:0;}'
      + '.apollo-menu .mn-hint{margin-top:8px;font-size:10px;letter-spacing:0.5px;line-height:1.4;}'
      + '.apollo-menu .mn-div{width:min(280px,80vw);margin:12px auto;}'
      + '.apollo-menu .mn-controls{font-size:11px;line-height:1.7;width:100%;max-width:100%;'
      +   'padding:0 4px;}'
      + '.apollo-menu .mn-controls span{letter-spacing:0;font-size:10px;}'
      + '.apollo-menu .mn-start{margin-top:14px;font-size:14px;letter-spacing:2px;'
      +   'padding:14px 16px;min-height:48px;width:100%;max-width:100%;}'
      + '.apollo-menu .mn-shop{margin-top:10px;font-size:12px;padding:12px 14px;letter-spacing:1px;'
      +   'width:100%;}'
      + '.apollo-menu .mn-foot{margin-top:12px;font-size:8px;letter-spacing:1px;}'
      /* Verdict on phone */
      + '.apollo-verdict{padding:max(12px,env(safe-area-inset-top)) 12px '
      +   'max(16px,env(safe-area-inset-bottom));overflow-y:auto;-webkit-overflow-scrolling:touch;}'
      + '.apollo-verdict .vd-title{font-size:clamp(26px,9vw,40px);letter-spacing:.08em;'
      +   'max-width:100%;text-align:center;line-height:1.1;text-indent:0;}'
      + '.apollo-verdict .vd-sub{font-size:11px;letter-spacing:2px;text-align:center;max-width:100%;'
      +   'padding:0 8px;}'
      + '.apollo-verdict .vd-stats{margin-top:14px;gap:4px 12px;font-size:11px;}'
      + '.apollo-verdict .vd-pay{font-size:20px;margin-top:12px;}'
      + '.apollo-verdict .vd-pay.sub{font-size:11px;}'
      + '.apollo-verdict .vd-refuel{width:min(240px,80vw);}'
      + '.apollo-verdict .vd-replay{margin-top:18px;font-size:14px;letter-spacing:2px;'
      +   'padding:14px 18px;min-height:48px;width:min(320px,92vw);max-width:100%;box-sizing:border-box;}'
      + '.apollo-verdict .vd-cmd{margin-top:14px;font-size:10px;letter-spacing:2px;text-align:center;'
      +   'max-width:100%;padding:0 10px;}'
      /* Shop — full safe-area card, scroll + sticky exit */
      + '.apollo-shop-inner{width:100%;max-height:100%;padding:10px 12px 14px;}'
      + '.apollo-shop h2{font-size:15px;letter-spacing:3px;text-indent:0;}'
      + '.apollo-shop .sp-desc{font-size:10px;margin:4px 0 8px;}'
      + '.apollo-shop .sp-item{padding:8px 10px;margin-bottom:8px;}'
      + '.apollo-verdict .vd-actions{margin-top:14px;width:min(300px,92%);}'
      + '.apollo-verdict .vd-hangar{font-size:12px;letter-spacing:1px;}'
      /* Dual-stick sizes for 390-wide phones */
      + '.apollo-touch-l{left:max(8px,env(safe-area-inset-left));width:120px;height:120px;}'
      + '.apollo-touch-r{right:max(8px,env(safe-area-inset-right));width:58px;height:156px;}'
      + '.apollo-env{bottom:max(190px,calc(env(safe-area-inset-bottom)+175px));}'
    + '}'
    /* Short phone viewport (Safari chrome ≈ 390×664): tighter menu stack */
    + '@media (max-width:480px) and (max-height:740px){'
      + '.apollo-menu .mn-kicker{margin-bottom:4px;}'
      + '.apollo-menu .mn-title{font-size:28px;}'
      + '.apollo-menu .mn-objective{font-size:11px;margin-top:8px;}'
      + '.apollo-menu .mn-controls{font-size:10px;line-height:1.55;}'
      + '.apollo-menu .mn-div{margin:10px auto;}'
      + '.apollo-menu .mn-hint{display:none;}'
      + '.apollo-menu .mn-foot{display:none;}'
      + '.apollo-menu .mn-start{margin-top:12px;}'
    + '}'
    /* Landscape phone (844×390): side notches eat L/R; don't stretch portrait HUD */
    + '@media (orientation:landscape) and (max-height:480px){'
      + '.apollo-telemetry{top:max(6px,env(safe-area-inset-top));'
      +   'left:max(8px,env(safe-area-inset-left));width:min(180px,28vw);padding:6px 8px;}'
      + '.apollo-fuelbar{left:max(8px,env(safe-area-inset-left));top:auto;'
      +   'bottom:max(8px,env(safe-area-inset-bottom));width:72px;padding:6px;}'
      + '.apollo-status{right:max(8px,env(safe-area-inset-right));'
      +   'top:max(6px,env(safe-area-inset-top));width:90px;transform:none;padding:4px;}'
      + '.apollo-tilt{right:max(8px,env(safe-area-inset-right));'
      +   'top:max(6px,env(safe-area-inset-top));transform:translateY(72px);width:78px;height:110px;}'
      + '.apollo-tilt svg{height:52px;}'
      + '.apollo-watch{top:max(6px,env(safe-area-inset-top));bottom:auto;}'
      + '.apollo-wallet{top:max(6px,env(safe-area-inset-top));}'
      + '.apollo-touch-l{left:max(8px,env(safe-area-inset-left));'
      +   'bottom:max(8px,env(safe-area-inset-bottom));width:100px;height:100px;}'
      + '.apollo-touch-r{right:max(8px,env(safe-area-inset-right));'
      +   'bottom:max(8px,env(safe-area-inset-bottom));width:52px;height:120px;}'
      + '.apollo-env{bottom:max(8px,env(safe-area-inset-bottom));'
      +   'left:50%;transform:translateX(-50%);}'
      + '.apollo-menu{padding:max(8px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) '
      +   'max(8px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));}'
      + '.apollo-menu .mn-title{font-size:clamp(22px,6vw,32px);}'
      + '.apollo-menu .mn-controls{display:none;}'
      + '.apollo-menu .mn-hint{display:none;}'
      + '.apollo-menu .mn-foot{display:none;}'
      + '.apollo-verdict{padding:max(8px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) '
      +   'max(8px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));}'
      + '.apollo-verdict .vd-title{font-size:clamp(22px,5vw,32px);}'
    + '}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('apollo-ui-style')) return;
    var s = document.createElement('style');
    s.id = 'apollo-ui-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---- helpers -------------------------------------------------------------
  function el(tag, cls, parent) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60), sec = s % 60;
    return pad2(m) + ':' + pad2(sec);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ==========================================================================
   * window.Apollo.UI
   * ======================================================================== */
  var UI = {

    root: null,
    _els: null,   // cached element refs keyed by name
    _cfg: null,
    _touchGraceUntil: 0,

    /* ---------------------------------------------------------------- init */
    init: function (container) {
      injectStyle();
      var C = container || document.body;
      if (this.root) this.root.remove(); // idempotent

      var root = el('div', 'apollo-root', C);
      this.root = root;
      var e = {};
      this._els = e;

      /* ---- telemetry panel ---- */
      var tel = el('div', 'apollo-mfd apollo-telemetry', root);
      tel.innerHTML =
        '<div class="apollo-tl-title"><span>DESCENT TELEMETRY</span><span class="tick">LUNAR OPS</span></div>'
      + '<div class="apollo-row"><span class="label">ALT</span><span class="value" data-k="alt">---</span></div>'
      + '<div class="apollo-row"><span class="label">VEL X</span><span class="value" data-k="vx">---</span></div>'
      + '<div class="apollo-row"><span class="label">VEL Z</span><span class="value" data-k="vz">---</span></div>'
      + '<div class="apollo-row"><span class="label">SINK</span><span class="value" data-k="vy">---</span></div>'
      + '<div class="apollo-row"><span class="label">DIST PAD</span><span class="value" data-k="dpad">---</span></div>'
      + '<div class="apollo-sep"></div>'
      + '<div class="apollo-row"><span class="label">LEAN X</span><span class="value" data-k="ang">---</span></div>'
      + '<div class="apollo-row"><span class="label">LEAN Z</span><span class="value" data-k="bank">---</span></div>'
      + '<div class="apollo-row"><span class="label">THRUST</span><span class="value" data-k="thr">---</span></div>'
      + '<div class="apollo-meter-wrap"><span class="apollo-meter-label">TANK</span>'
      + '<div class="apollo-meter"><div class="apollo-meter-fill" data-k="mt"></div></div></div>';

      e.alt = tel.querySelector('[data-k=alt]');
      e.vx = tel.querySelector('[data-k=vx]');
      e.vz = tel.querySelector('[data-k=vz]');
      e.vy = tel.querySelector('[data-k=vy]');
      e.dpad = tel.querySelector('[data-k=dpad]');
      e.ang = tel.querySelector('[data-k=ang]');
      e.bank = tel.querySelector('[data-k=bank]');
      e.thr = tel.querySelector('[data-k=thr]');
      e.mt = tel.querySelector('[data-k=mt]');
      e.tel = tel;

      /* ---- fuel bar ---- */
      var fb = el('div', 'apollo-mfd apollo-fuelbar', root);
      fb.innerHTML =
        '<div class="fb-title">FUEL RESERVES</div>'
      + '<div class="fb-track"><div class="fb-fill" data-k="fb"></div></div>'
      + '<div class="fb-num" data-k="fbn">---%</div>';
      e.fb = fb.querySelector('[data-k=fb]');
      e.fbn = fb.querySelector('[data-k=fbn]');

      /* ---- tilt indicator: ADI + dual X / Z lean graphs ---- */
      var tilt = el('div', 'apollo-mfd apollo-tilt', root);
      tilt.innerHTML =
        '<div class="ti-title">ATTITUDE</div>'
      + '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">'
      +   '<circle cx="50" cy="50" r="42" fill="none" stroke="rgba(0,229,255,.28)" stroke-width="1"/>'
      +   '<circle cx="50" cy="50" r="34" fill="none" stroke="rgba(0,229,255,.15)" stroke-width="1" stroke-dasharray="2 3"/>'
      +   '<g stroke="rgba(0,229,255,.5)" stroke-width="1.5">'
      +     '<line x1="50" y1="4" x2="50" y2="10"/>'
      +     '<line x1="50" y1="90" x2="50" y2="96"/>'
      +     '<line x1="4" y1="50" x2="10" y2="50"/>'
      +     '<line x1="90" y1="50" x2="96" y2="50"/>'
      +   '</g>'
      +   '<g id="ap-tilt-horiz" style="filter:drop-shadow(0 0 3px rgba(53,255,158,.9));">'
      +     '<line x1="10" y1="50" x2="90" y2="50" stroke="rgba(53,255,158,.9)" stroke-width="1.6"/>'
      +     '<polygon points="50,46 54,50 50,54 46,50" fill="rgba(53,255,158,.9)"/>'
      +   '</g>'
      +   '<line id="ap-tilt-v" x1="50" y1="44" x2="50" y2="56" '
      +     'stroke="rgba(255,255,255,.55)" stroke-width="1"/>'
      +   '<circle id="ap-tilt-pip" cx="50" cy="50" r="1.8" fill="rgba(0,229,255,.9)"/>'
      + '</svg>'
      // Explicit dual graphs: LEAN X (left/right) + LEAN Z (fore/aft) — phone-readable.
      + '<div class="ti-graphs">'
      +   '<div class="ti-g">'
      +     '<div class="ti-g-lab">LEAN X</div>'
      +     '<div class="ti-g-track ti-g-h"><div class="ti-g-mark" data-k="leanXMark"></div></div>'
      +   '</div>'
      +   '<div class="ti-g">'
      +     '<div class="ti-g-lab">LEAN Z</div>'
      +     '<div class="ti-g-track ti-g-v"><div class="ti-g-mark" data-k="leanZMark"></div></div>'
      +   '</div>'
      + '</div>';
      e.tiltH = tilt.querySelector('#ap-tilt-horiz');
      e.tiltV = tilt.querySelector('#ap-tilt-v');
      e.tiltPip = tilt.querySelector('#ap-tilt-pip');
      e.leanXMark = tilt.querySelector('[data-k=leanXMark]');
      e.leanZMark = tilt.querySelector('[data-k=leanZMark]');

      /* ---- status card + watch ---- */
      var st = el('div', 'apollo-mfd apollo-status', root);
      st.innerHTML =
        '<div class="st-main" data-k="st">STANDBY</div>'
      + '<div class="st-sub" data-k="stsub">SYSTEMS NOMINAL</div>';
      e.st = st.querySelector('[data-k=st]');
      e.stsub = st.querySelector('[data-k=stsub]');

      var watch = el('div', 'apollo-mfd apollo-watch', root);
      watch.innerHTML =
        '<div class="wk">T-MINUS &nbsp;·&nbsp; MISSION CLOCK</div>'
      + '<div class="wv" data-k="wv">00:00</div>';
      e.wv = watch.querySelector('[data-k=wv]');

      /* ---- dual-stick multi-touch (wired in game.js; two fingers OK) ---- */
      var tL = el('div', 'apollo-touch apollo-touch-l', root);
      tL.innerHTML =
        '<div class="apollo-tilt-stick" data-k="tiltStick" aria-label="Aim stick 360 degrees">'
      +   '<div class="ts-cross"></div>'
      +   '<div class="ts-label">AIM 360°</div>'
      +   '<div class="ts-hint">POINT NOSE</div>'
      +   '<div class="ts-knob" data-k="tiltKnob"></div>'
      + '</div>';
      var tR = el('div', 'apollo-touch apollo-touch-r', root);
      tR.innerHTML =
        '<div class="apollo-thr-slider" data-k="thrTrack" aria-label="Boost slider vertical">'
      +   '<div class="thr-fill" data-k="thrFill"></div>'
      +   '<div class="thr-label">BOOST</div>'
      + '</div>';
      e.tiltStick = tL.querySelector('[data-k=tiltStick]');
      e.tiltKnob = tL.querySelector('[data-k=tiltKnob]');
      e.thrTrack = tR.querySelector('[data-k=thrTrack]');
      e.thrFill = tR.querySelector('[data-k=thrFill]');
      e.touchL = tL;
      e.touchR = tR;

      /* Live envelope stress pips */
      var env = el('div', 'apollo-env', root);
      env.innerHTML =
        '<div class="env-pip" data-k="envSink">SINK</div>'
      + '<div class="env-pip" data-k="envAng">TILT</div>'
      + '<div class="env-pip" data-k="envFuel">FUEL</div>';
      e.env = env;
      e.envSink = env.querySelector('[data-k=envSink]');
      e.envAng = env.querySelector('[data-k=envAng]');
      e.envFuel = env.querySelector('[data-k=envFuel]');

      /* ---- low-altitude proximity / PULL-UP warning banner (freegle idea #4) ---- */
      var prox = el('div', 'apollo-prox apollo-hidden', root);
      prox.innerHTML =
        '<div class="px-line px-main">PULL UP</div>'
      + '<div class="px-line px-sub">RETRO THRUST · TOUCHDOWN 11 m/s</div>'
      + '<div class="px-alt" data-k="pxAlt">ALT 0m</div>';
      e.proxWarn = prox;
      e.pxAlt = prox.querySelector('[data-k=pxAlt]');

      /* ---- center reticle ---- */
      var ret = el('div', 'apollo-reticle', root);
      ret.innerHTML =
        '<div class="ret-ring"></div>'
      + '<div class="ret-circle"></div>'
      + '<div class="ret-x"><i class="h"></i><i class="v"></i></div>'
      + '<div class="ret-tick" style="left:50%;top:16px;margin-left:-1px;"></div>'
      + '<div class="ret-tick" style="left:50%;bottom:16px;margin-left:-1px;"></div>'
      + '<div class="ret-tick" style="top:50%;left:16px;margin-top:-3px;width:7px;height:2px;"></div>'
      + '<div class="ret-tick" style="top:50%;right:16px;margin-top:-3px;width:7px;height:2px;"></div>';

      /* ---- vignette / scanlines ---- */
      el('div', 'apollo-vignette', root);

      /* ---- verdict + menu (hidden) ---- */
      var verdict = el('div', 'apollo-verdict', root);
      e.verdict = verdict;
      var menu = el('div', 'apollo-menu apollo-hidden', root);
      e.menu = menu;

      /* ---- wallet chip + SHOP overlay (hangar opens from verdict only) ---- */
      var wl = el('div', 'apollo-mfd apollo-wallet', root);
      wl.innerHTML =
        '<span class="w-ic">$</span><span class="w-bal" data-k="wal">0</span>';
      e.wal = wl.querySelector('[data-k=wal]');
      e.shopbtn = null;
      e.wallet = wl;
      var shop = el('div', 'apollo-shop', root);
      e.shop = shop;

      return this;
    },

    /* -------------------------------------------------------------- update */
    update: function (state, cfg) {
      if (!this.root || !state) return;
      var e = this._els;
      var C = cfg || this._cfg || {};
      var SAFE = (C.SAFE_SPEED != null ? C.SAFE_SPEED : 11.0);
      var SAFE_ANG = (C.SAFE_ANGLE != null ? C.SAFE_ANGLE : 0.70);

      var alt = (state.altitude != null) ? state.altitude : 0;
      var vel = state.velocity || { x: 0, y: 0, z: 0 };
      // Fuel shown as % of the CURRENT tank size (economy bigger-tank upgrade
      // raises the denominator, so 100% now means a bigger absolute reserve).
      var maxFuel = (state.maxFuel != null && state.maxFuel > 0) ? state.maxFuel
                   : (C.maxFuel != null && C.maxFuel > 0 ? C.maxFuel : 100);
      var fuelAbs = clamp(state.fuel != null ? state.fuel : maxFuel, 0, maxFuel);
      var fuel = (fuelAbs / maxFuel) * 100;
      var ang = (state.angle != null) ? state.angle : 0;
      var bank = (state.bank != null) ? state.bank : 0;
      var tiltTot = (state.tiltTotal != null) ? state.tiltTotal
        : Math.hypot(ang, bank);
      // state.thrust is a 0..1 throttle (engine.js). Display as % directly.
      var thrRaw = (state.thrust != null) ? state.thrust : 0;
      var thr = clamp(thrRaw * 100, 0, 100);
      var angDeg = (typeof ang === 'number') ? (ang * 180 / Math.PI) : ang;
      var bankDeg = (typeof bank === 'number') ? (bank * 180 / Math.PI) : bank;

      var speed = Math.hypot(vel.x || 0, vel.y || 0, vel.z || 0);

      /* altitude */
      e.alt.textContent = (alt >= 0 ? alt.toFixed(1) : '0.0') + ' m';
      setRow(e.alt, false, true);

      /* velocity rows (x / z / sink) */
      e.vx.textContent = (vel.x||0).toFixed(1) + ' m/s';
      if (e.vz) {
        e.vz.textContent = (vel.z||0).toFixed(1) + ' m/s';
        setRow(e.vz, Math.abs(vel.z||0) > SAFE);
      }
      e.vy.textContent = (vel.y||0).toFixed(1) + ' m/s';
      setRow(e.vx, Math.abs(vel.x||0) > SAFE);
      setRow(e.vy, (vel.y||0) < -SAFE);

      /* distance to active career pad */
      if (e.dpad) {
        var tgt = state.padTarget || { x: 0, z: 0 };
        var sx = state.x != null ? state.x : 0;
        var sz = state.z != null ? state.z : 0;
        var dPad = Math.hypot(sx - (tgt.x || 0), sz - (tgt.z || 0));
        e.dpad.textContent = dPad.toFixed(1) + ' m';
        setRow(e.dpad, dPad > 2, true);
      }

      /* lean X + lean Z (both attitude graphs) */
      e.ang.textContent = angDeg.toFixed(1) + '°';
      setRow(e.ang, Math.abs(tiltTot) > SAFE_ANG);
      if (e.bank) {
        e.bank.textContent = bankDeg.toFixed(1) + '°';
        setRow(e.bank, Math.abs(tiltTot) > SAFE_ANG);
      }

      /* thrust */
      e.thr.textContent = thr.toFixed(0) + ' %';
      setRow(e.thr, false, true);

      /* tank meter (linear) */
      e.mt.style.width = fuel.toFixed(0) + '%';
      if (fuel <= 15) e.mt.classList.add('low'); else e.mt.classList.remove('low');

      /* fuel bar (repeating fill, clipped by width) */
      e.fb.style.width = fuel.toFixed(0) + '%';
      if (fuel <= 15) e.fb.classList.add('low'); else e.fb.classList.remove('low');
      e.fbn.textContent = fuel.toFixed(0) + '%';

      /* Dual-axis attitude: ADI + explicit LEAN X / LEAN Z graphs. */
      var disp = clamp((typeof ang === 'number' ? ang : 0), -Math.PI / 2, Math.PI / 2);
      var deg = -disp * 180 / Math.PI;
      e.tiltH.setAttribute('transform', 'rotate(' + deg.toFixed(1) + ' 50 50)');
      if (e.tiltPip) {
        var pipX = 50 + clamp(ang, -1, 1) * 28;
        var pipY = 50 + clamp(bank, -1, 1) * 28;
        e.tiltPip.setAttribute('cx', pipX.toFixed(1));
        e.tiltPip.setAttribute('cy', pipY.toFixed(1));
      }
      if (e.tiltV) {
        // Vertical ADI tick tracks lean-Z.
        var bdeg = clamp(bank, -Math.PI / 2, Math.PI / 2) * 180 / Math.PI;
        e.tiltV.setAttribute('transform', 'rotate(' + bdeg.toFixed(1) + ' 50 50)');
      }
      // Linear graph needles: 0% = left/aft, 50% = upright, 100% = right/fore.
      if (e.leanXMark) {
        var xPct = 50 + clamp(ang / (Math.PI * 0.5), -1, 1) * 48;
        e.leanXMark.style.left = xPct.toFixed(1) + '%';
        e.leanXMark.style.marginLeft = '-1.5px';
        e.leanXMark.style.background = Math.abs(tiltTot) > SAFE_ANG ? '#ff4d5e' : '#35ff9e';
      }
      if (e.leanZMark) {
        var zPct = 50 + clamp(bank / (Math.PI * 0.5), -1, 1) * 48;
        e.leanZMark.style.top = zPct.toFixed(1) + '%';
        e.leanZMark.style.marginTop = '-1.5px';
        e.leanZMark.style.background = Math.abs(tiltTot) > SAFE_ANG ? '#ff4d5e' : '#35ff9e';
      }
      /* status card — thrust-aware sub-label (freegle loop-1 P2: it always
         said "THROTTLE ENGAGED" even at 0% thrust, which read as a bug) */
      var status = state.status || '';
      var stTxt, stSub;
      switch (status) {
        case 'playing':
          stTxt = 'DESCENT';
          stSub = (thr > 1) ? 'THROTTLE ENGAGED '
            : ((thr > 0.1) ? 'LIGHT THROTTLE' : 'DRIFT · RETRO READY');
          break;
        case 'landed':  stTxt = 'ON PAD';  stSub = 'MISSION COMPLETE'; break;
        case 'crashed': stTxt = 'LOST';    stSub = 'IMPACT DETECTED';  break;
        default:        stTxt = 'STANDBY'; stSub = 'SYSTEMS NOMINAL';  break;
      }
      e.st.textContent = stTxt;
      e.stsub.textContent = stSub;
      e.st.style.color = (status === 'crashed') ? '#ff4d5e' : (
        (status === 'landed') ? '#35ff9e' : '#bffcff');

      /* Low-altitude proximity warning (freegle idea #4 / recommended #2):
         below ~25m toggle a PULL-UP banner + flash ALT/SINK red when the
         sink rate is nearing the safe limit. game.js drives the audio ping. */
      if (e.proxWarn) {
        var proxAlt = 25;
        var near = (status === 'playing') && (alt < proxAlt);
        var sinkFast = near && (vel.y || 0) < -SAFE;
        var showProx = near;
        e.proxWarn.classList.toggle('apollo-hidden', !showProx);
        if (showProx && e.pxAlt) e.pxAlt.textContent = 'ALT ' + alt.toFixed(0) + 'm'
          + (sinkFast ? ' · SINK ' + Math.abs(vel.y || 0).toFixed(1) : '');
        // flash the danger rows while near ground
        setRow(e.alt, near && (sinkFast || alt < 10), true);
        setRow(e.vy, sinkFast, true);
        if (e.stsub) e.stsub.style.color = near && sinkFast ? '#ff4d5e' : '';
      }

      /* touch pads appear only while actually flying — but keep them on the
         screen from the moment play starts (grace window) so a fast verdict
         can never flash-and-vanish them, and iOS users can find them. */
      var showT = (status === 'playing') || (this._touchGraceUntil > performance.now());
      if (e.touchL) e.touchL.classList.toggle('show', showT);
      if (e.touchR) e.touchR.classList.toggle('show', showT);

      /* sand-style live envelope pips */
      if (e.env) {
        e.env.classList.toggle('show', showT);
        var env = state.envelope || {};
        function pip(elp, band, label) {
          if (!elp) return;
          elp.className = 'env-pip ' + (band || 'green');
          elp.textContent = label;
        }
        pip(e.envSink, env.sink, env.bingo ? 'BINGO' : 'SINK');
        pip(e.envAng, env.angle, 'TILT');
        pip(e.envFuel, env.fuel, 'FUEL');
      }

      /* clock */
      if (state.time != null) e.wv.textContent = fmtTime(state.time);

      /* wallet balance (persistent across runs) */
      if (e.wal) {
        var eco = window.Apollo.Economy;
        var bal = (eco && typeof eco.dollars === 'function') ? eco.dollars() : 0;
        e.wal.textContent = String(Math.floor(bal));
      }

      /* store config for later verdicts */
      if (cfg) this._cfg = cfg;
    },

    /* ----------------------------------------------------------- showVerDct */
    showVerDct: function (state, goodLanding) {
      if (!this._els) return;
      var e = this._els;
      var v = e.verdict;
      var vel = state.velocity || { x: 0, y: 0 };
      // Use the impact speed captured at touchdown (pre-zero), not the zeroed
      // post-collision velocity, so the verdict shows real numbers (freegle P3).
      var speed = (state.impact_speed != null) ? state.impact_speed
                  : Math.hypot(vel.x || 0, vel.y || 0);
      var angDeg = ((state.angle||0) * 180 / Math.PI).toFixed(1);
      // Verdict fuel shown as % of the CURRENT tank size (freegle AAA audit #3:
      // was absolute units + a '%' sign, so a tank upgrade showed '140.0 %').
      var maxFuelV = (state.maxFuel != null && state.maxFuel > 0) ? state.maxFuel
                    : ((this._cfg || {}).maxFuel || 100);
      var fuel = Math.max(0, (state.fuel != null ? state.fuel : 0) / maxFuelV * 100).toFixed(1);

      v.className = 'apollo-verdict ' + (goodLanding ? 'good' : 'bad');

      var stats =
        '<b>TOUCHDOWN SPEED</b><span>' + speed.toFixed(1) + ' m/s</span>'
      + '<b>VERTICAL RATE</b><span>' + (state.impact_vy != null ? state.impact_vy : (vel.y||0)).toFixed(1) + ' m/s</span>'
      + '<b>FINAL TILT</b><span>' + angDeg + '°</span>'
      + '<b>FUEL REMAINING</b><span>' + fuel + ' %</span>'
      + '<b>MISSION TIME</b><span>' + fmtTime(state.time||0) + '</span>';

      var grade = state.lastGrade || (state.lastReward && state.lastReward.grade) || null;
      var gradeBlock = '';
      if (grade && grade.letter) {
        var stars = '';
        for (var si = 0; si < 3; si++) stars += (si < (grade.stars || 0)) ? '★' : '☆';
        gradeBlock =
          '<div class="vd-grade">' + grade.letter + '</div>'
        + '<div class="vd-grade-sub">' + (grade.label || '') + '</div>'
        + '<div class="vd-stars">' + stars + '</div>'
        + (grade.letter === 'S'
          ? '<div class="vd-flourish">★ PERFECT TOUCHDOWN — CLEAN RUN ★</div>'
          : (grade.letter === 'A'
            ? '<div class="vd-flourish">CLEAN RUN — EXCELLENT FLARE</div>'
            : ''));
      }
      var xpLine = '';
      if (state.lastReward && state.lastReward.xpGain != null) {
        xpLine = '<div class="vd-xp">+' + state.lastReward.xpGain + ' XP'
          + (state.lastReward.streak ? ' · STREAK ' + state.lastReward.streak : '')
          + (state.lastReward.careerLevel ? ' · PILOT LV ' + state.lastReward.careerLevel : '')
          + '</div>';
        if (state.lastReward.unlocks && state.lastReward.unlocks.length) {
          xpLine += '<div class="vd-xp">PLANET UNLOCKED: '
            + state.lastReward.unlocks.join(', ').toUpperCase() + '</div>';
        }
      }
      var padLabel = (state.padName || state.padTarget && state.padTarget.name || 'PAD');
      var planetLabel = state.planetName || '';

      var whyBlock = (!goodLanding && state.crashReason)
        ? '<div class="vd-why">' + state.crashReason + '</div>' : '';

      if (goodLanding) {
        v.innerHTML =
          '<div class="vd-title">MISSION ACCOMPLISHED</div>'
        + '<div class="vd-sub">' + planetLabel + ' · ' + padLabel + ' ✔</div>'
        + gradeBlock
        + '<div class="vd-stats">' + stats + '</div>'
        + payHTML(state, 'good')
        + xpLine
        + refuelHTML()
        + '<div class="vd-actions">'
        +   '<button class="vd-hangar" data-k="hangar">MISSION HANGAR ▸</button>'
        +   '<button class="vd-replay" data-k="replay">REFUEL &amp; RELAUNCH ▸</button>'
        +   '<button class="vd-menu" data-k="tomenu">MAIN MENU / OPTIONS ▸</button>'
        + '</div>'
        + '<div class="vd-cmd">UPGRADE · TWEAK CONTROLS · OR RELAUNCH</div>';
      } else {
        v.innerHTML =
          '<div class="vd-title">CRASHED</div>'
        + '<div class="vd-sub">KEEP DESCENT WITHIN SAFE SPEED · HIT THE LIT PAD</div>'
        + whyBlock
        + gradeBlock
        + '<div class="vd-stats">' + stats + '</div>'
        + payHTML(state, 'bad')
        + xpLine
        + refuelHTML()
        + '<div class="vd-actions">'
        +   '<button class="vd-hangar" data-k="hangar">MISSION HANGAR ▸</button>'
        +   '<button class="vd-replay" data-k="replay">REFUEL &amp; RELAUNCH ▸</button>'
        +   '<button class="vd-menu" data-k="tomenu">MAIN MENU / OPTIONS ▸</button>'
        + '</div>'
        + '<div class="vd-cmd">CHECK WHY ABOVE · EDIT OPTIONS · TRY AGAIN</div>';
      }

      // REFUEL & RELAUNCH — layers a ~1.6s refuel fill animation (the
      // "refuel while you wait" beat) on top, then relaunches. Wired to the
      // pointer/touch path directly (NOT _wireReplay): _wireReplay's instant
      // onclick would relaunch immediately and cut the refuel animation short,
      // and on mobile touchstart would skip it entirely.
      var self = this;
      var hg = v.querySelector('[data-k=hangar]');
      if (hg) {
        var openH = function (ev) {
          if (ev && ev.cancelable) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          self.openShop();
        };
        hg.onclick = openH;
        hg.addEventListener('pointerup', openH, { passive: false });
        hg.addEventListener('touchend', openH, { passive: false });
      }
      var rp = v.querySelector('[data-k=replay]');
      if (rp) {
        rp.onclick = function () { self._runRefuel(v); };
        rp.addEventListener('touchend', function (ev) {
          if (ev && ev.preventDefault) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          self._runRefuel(v);
        }, { passive: false });
      }
      var tm = v.querySelector('[data-k=tomenu]');
      if (tm) {
        var goMenu = function (ev) {
          if (ev && ev.cancelable) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          self._closeShop();
          self._clearVerdict();
          if (typeof self._menuReturnCb === 'function') self._menuReturnCb();
          else self.showMenu(self._onStartCb);
        };
        tm.onclick = goMenu;
        tm.addEventListener('pointerup', goMenu, { passive: false });
        tm.addEventListener('touchend', goMenu, { passive: false });
      }
      // force reflow then show for transition
      void v.offsetWidth;
      v.classList.add('show');
    },

    setCareerHandler: function (fn) { this._careerCb = fn; },
    setMenuReturnHandler: function (fn) { this._menuReturnCb = fn; },

    /* -------------------------------------------------------------- showMenu */
    showMenu: function (onStart) {
      if (!this._els) return;
      var e = this._els;
      var m = e.menu;
      var selfMenu = this;
      if (typeof onStart === 'function') this._onStartCb = onStart;
      if (this.root) this.root.classList.add('menu-mode');
      m.className = 'apollo-menu';

      function renderMenu() {
        var eco = window.Apollo.Economy;
        var car = window.Apollo.Career;
        var opts = (window.Apollo.Settings && window.Apollo.Settings.get)
          ? window.Apollo.Settings.get() : { invertX: false, invertY: false, sensitivity: 1 };
        var lv = (eco && eco.careerLevel) ? eco.careerLevel() : 1;
        var xp = (eco && eco.xp) ? eco.xp() : 0;
        var xpNeed = (car && car.XP_PER_LEVEL) ? car.XP_PER_LEVEL : 120;
        var xpIn = (car && car.xpIntoLevel) ? car.xpIntoLevel(xp) : (xp % xpNeed);
        var planetId = (eco && eco.planetId) ? eco.planetId() : 'luna';
        var padId = (eco && eco.padId) ? eco.padId() : 'luna-train';
        var unlocked = (eco && eco.unlockedPlanets) ? eco.unlockedPlanets() : ['luna'];
        var planets = (car && car.PLANETS) ? car.PLANETS : [];
        var planet = car ? car.planetById(planetId) : null;
        var pads = (planet && planet.pads) || [];
        var clears = (eco && eco.store && eco.store.padClears) || {};

        var pBtns = planets.map(function (p) {
          var open = unlocked.indexOf(p.id) >= 0;
          var on = p.id === planetId;
          var cls = 'mn-pbtn' + (on ? ' on' : '') + (open ? '' : ' locked');
          var label = open ? p.name : (p.name + ' · LV' + p.unlockLevel);
          return '<button type="button" class="' + cls + '" data-planet="' + p.id + '"'
            + (open ? '' : ' disabled') + '>' + label + '</button>';
        }).join('');

        var padRows = pads.map(function (pd) {
          var on = pd.id === padId;
          var best = clears[pd.id] || '—';
          var stars = '';
          for (var di = 0; di < (pd.diff || 1); di++) stars += '◆';
          var trip = (car && car.padTripMeters) ? car.padTripMeters(pd) : 0;
          var mult = (car && car.distancePayMult) ? car.distancePayMult(pd)
            : (pd.mult || 1);
          return '<button type="button" class="mn-pad' + (on ? ' on' : '') + '" data-pad="' + pd.id + '">'
            + '<b>' + pd.name + '</b>'
            + '<div class="pd-meta">DIFF ' + stars + ' · ' + trip + 'm hop · ×' + Number(mult).toFixed(1)
            + ' · BEST ' + best + ' · r' + (pd.r || 0).toFixed(0) + 'm</div>'
            + '</button>';
        }).join('');

        m.innerHTML =
          '<div class="mn-card">'
        +   '<div class="mn-kicker">CAREER OPS</div>'
        +   '<div class="mn-title">APOLLO<br>DESCENT</div>'
        +   '<div class="mn-sub">PLANETS · PADS · GRADES</div>'
        +   '<div class="mn-lv">PILOT LV ' + lv + ' · ' + xpIn + '/' + xpNeed + ' XP'
        +     (eco && eco.streak ? ' · STREAK ' + eco.streak() : '') + '</div>'
        +   '<div class="mn-planets">' + pBtns + '</div>'
        +   '<div class="mn-pads">' + padRows + '</div>'
        +   '<div class="mn-div"></div>'
        +   '<div class="mn-controls">'
        +     '<div><b>AIM 360°</b> <span>left stick · lean any way (diags OK)</span></div>'
        +     '<div><b>BOOST</b> <span>right slider ↑ · two thumbs OK</span></div>'
        +     '<div><b>LOOK</b> <span>drag empty sky · works with steer/thrust</span></div>'
        +     '<div><b>PAY</b> <span>farther pad hop → bigger $ · hangar after run</span></div>'
        +   '</div>'
        +   '<div class="mn-opts">'
        +     '<div class="mn-opts-title">CONTROLLER OPTIONS</div>'
        +     '<div class="mn-opt-row"><label>INVERT AIM X</label>'
        +       '<button type="button" class="mn-tog' + (opts.invertX ? ' on' : '') + '" data-opt="invertX">'
        +       (opts.invertX ? 'ON' : 'OFF') + '</button></div>'
        +     '<div class="mn-opt-row"><label>INVERT AIM Y</label>'
        +       '<button type="button" class="mn-tog' + (opts.invertY ? ' on' : '') + '" data-opt="invertY">'
        +       (opts.invertY ? 'ON' : 'OFF') + '</button></div>'
        +     '<div class="mn-opt-row"><label>TILT SENS</label>'
        +       '<span class="mn-sens-val" data-k="sensVal">' + Number(opts.sensitivity).toFixed(2) + '×</span></div>'
        +     '<input class="mn-sens" data-k="sens" type="range" min="50" max="160" step="5" value="'
        +       Math.round(opts.sensitivity * 100) + '" aria-label="Tilt sensitivity"/>'
        +   '</div>'
        +   '<button type="button" class="mn-start" data-k="start">INITIATE DESCENT ▸</button>'
        +   '<div class="mn-foot">LAND / CRASH → HANGAR UPGRADES → RELAUNCH</div>'
        + '</div>';

        try { m.scrollTop = 0; } catch (err) { /* */ }

        Array.prototype.forEach.call(m.querySelectorAll('[data-planet]'), function (b) {
          b.addEventListener('pointerup', function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            var pid = b.getAttribute('data-planet');
            var p = car.planetById(pid);
            var firstPad = p && p.pads && p.pads[0] ? p.pads[0].id : null;
            if (typeof selfMenu._careerCb === 'function') selfMenu._careerCb(pid, firstPad);
            else if (eco && eco.setSelection) eco.setSelection(pid, firstPad);
            renderMenu();
          }, { passive: false });
        });
        Array.prototype.forEach.call(m.querySelectorAll('[data-pad]'), function (b) {
          b.addEventListener('pointerup', function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            var pad = b.getAttribute('data-pad');
            var pid = (eco && eco.planetId) ? eco.planetId() : 'luna';
            if (typeof selfMenu._careerCb === 'function') selfMenu._careerCb(pid, pad);
            else if (eco && eco.setSelection) eco.setSelection(pid, pad);
            renderMenu();
          }, { passive: false });
        });

        var btn = m.querySelector('[data-k=start]');
        if (btn) {
          var startOnce = function (ev) {
            if (ev && ev.cancelable) ev.preventDefault();
            if (ev && ev.stopPropagation) ev.stopPropagation();
            if (btn._apolloStarted) return;
            btn._apolloStarted = true;
            if (window.Apollo.Audio) { window.Apollo.Audio.unlock(); window.Apollo.Audio.beep(660); }
            if (typeof onStart === 'function') onStart();
            else if (typeof selfMenu._onStartCb === 'function') selfMenu._onStartCb();
            selfMenu.hideMenu();
          };
          btn.onclick = startOnce;
          btn.addEventListener('pointerup', startOnce, { passive: false });
          btn.addEventListener('touchend', startOnce, { passive: false });
        }
        // Controller options toggles / sensitivity
        Array.prototype.forEach.call(m.querySelectorAll('[data-opt]'), function (b) {
          b.addEventListener('pointerup', function (ev) {
            if (ev && ev.preventDefault) ev.preventDefault();
            var key = b.getAttribute('data-opt');
            var cur = (window.Apollo.Settings && window.Apollo.Settings.get)
              ? window.Apollo.Settings.get() : {};
            var patch = {};
            patch[key] = !cur[key];
            if (window.Apollo.Settings && window.Apollo.Settings.set) {
              window.Apollo.Settings.set(patch);
            }
            renderMenu();
          }, { passive: false });
        });
        var sens = m.querySelector('[data-k=sens]');
        if (sens) {
          sens.addEventListener('input', function () {
            var v = Number(sens.value) / 100;
            if (window.Apollo.Settings && window.Apollo.Settings.set) {
              window.Apollo.Settings.set({ sensitivity: v });
            }
            var lab = m.querySelector('[data-k=sensVal]');
            if (lab) lab.textContent = v.toFixed(2) + '×';
          });
        }
      }

      renderMenu();
      if (e.verdict) e.verdict.classList.remove('show');
    },

    /* -------------------------------------------------------------- hideMenu */
    hideMenu: function () {
      if (this._els) {
        this._els.menu.className = 'apollo-menu apollo-hidden';
      }
      if (this.root) this.root.classList.remove('menu-mode');
    },

    /* ------------------------------------------------- step / replay api */
    /* game.js registers a restart callback so the verdict RELAUNCH button can
       restart a run from a real iOS Safari tap (keyboard R doesn't exist). */
    setReplayHandler: function (fn) { this._replayCb = fn; },

    _wireReplay: function (btn) {
      var self = this;
      function goOnce(e) {
        if (e && e.cancelable) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        if (typeof self._replayCb === 'function') self._replayCb();
      }
      btn.onclick = goOnce;
      btn.addEventListener('touchstart', goOnce, { passive: false });
      btn.addEventListener('touchend', function (e) {
        if (e && e.preventDefault) e.preventDefault();
      }, { passive: false });
    },

    /* ------------------------------------------------------- clearVerdict */
    /* Called by game.js:startGame() on RELAUNCH. CRITICAL (freegle re-dogfood t_32f938f5):
       this was referenced but never defined, so the .show verdict overlay stayed
       pointer-events:auto on top of the pads and soft-locked iOS after run 1. */
    _clearVerdict: function () {
      if (this._els) {
        var v = this._els.verdict;
        if (v) v.classList.remove('show');
      }
    },

    /* -------------------------------------------------- refuel beat */
    /* Fills the verdict refuel bar over ~1.6s (the "refuel while you wait"
       beat), masking the tank refill that always happens between runs, then
       relaunches. Guarded so one tap can't stack multiple timers. */
    _runRefuel: function (v) {
      if (this._refueling) return;
      this._refueling = true;
      if (window.Apollo.Audio && window.Apollo.Audio.refuel) window.Apollo.Audio.refuel();
      var bar = v && v.querySelector ? v.querySelector('.vd-refuel .rf-fill') : null;
      var btn = v && v.querySelector ? v.querySelector('[data-k=replay]') : null;
      if (bar) bar.classList.add('busy');
      if (btn) btn.disabled = true;
      var self = this;
      var t0 = performance.now();
      var dur = 1600;
      (function tick() {
        var el = v ? v.querySelector('.vd-refuel .rf-fill') : null;
        var p = Math.min(1, (performance.now() - t0) / dur);
        if (el) el.style.width = (p * 100).toFixed(1) + '%';
        if (p < 1) { requestAnimationFrame(tick); }
        else {
          self._refueling = false;
          if (btn) btn.disabled = false;
          if (typeof self._replayCb === 'function') self._replayCb();
        }
      })();
    },

    /* ------------------------------------------------------ SHOP */
    /* Build + show the upgrade shop overlay (menu button or wallet chip). */
    openShop: function () {
      if (!this._els || !this._els.shop) return;
      this._buildShop(this._els.shop);
      void this._els.shop.offsetWidth;
      this._els.shop.classList.add('show');
    },
    _closeShop: function () {
      if (this._els && this._els.shop) this._els.shop.classList.remove('show');
    },

    _buildShop: function (container) {
      var eco = window.Apollo.Economy;
      var self = this;
      var bal = (eco && typeof eco.dollars === 'function') ? eco.dollars() : 0;
      var lv = (eco && eco.store && eco.store.levels) || { tank: 0, engine: 0, rcs: 0, legs: 0 };

      function buyRow(id) {
        var cat = eco.CATALOG[id];
        if (!cat) return '';
        var cur = lv[id] || 0;
        var cost = eco.nextCost(cat, cur);
        var maxed = cost < 0;
        var curVal = cat.values[cur];
        var nextVal = maxed ? curVal : cat.values[cur + 1];
        var valTxt;
        if (id === 'tank') valTxt = curVal + ' → ' + nextVal + ' fuel';
        else if (id === 'engine') valTxt = 'x' + curVal.toFixed(2) + ' → x' + nextVal.toFixed(2) + ' thrust';
        else if (id === 'rcs') valTxt = curVal.toFixed(1) + ' → ' + nextVal.toFixed(1) + ' rad/s';
        else if (id === 'legs') valTxt = 'x' + curVal.toFixed(2) + ' → x' + nextVal.toFixed(2) + ' safe';
        else valTxt = String(curVal);
        var btnTxt, cls, disabled;
        if (maxed) { btnTxt = 'MAXED OUT'; cls = 'maxed'; disabled = true; }
        else if (bal < cost) { btnTxt = '$' + cost + ' — NEED MORE $'; cls = ''; disabled = true; }
        else { btnTxt = 'BUY $' + cost; cls = ''; disabled = false; }
        var fillPct = (cur / eco.MAX_LEVEL) * 100;
        return '<div class="sp-item">'
          + '<div class="sp-item-head"><span class="sp-name">' + cat.label + '</span>'
          + '<span class="sp-lv">LV ' + cur + ' / ' + eco.MAX_LEVEL + ' · ' + valTxt + '</span></div>'
          + '<div class="sp-desc">' + cat.desc + '</div>'
          + '<div class="sp-tank"><div class="sp-tank-fill" style="width:' + fillPct.toFixed(0) + '%"></div></div>'
          + '<button class="sp-buy ' + cls + '" data-buy="' + id + '" ' + (disabled ? 'disabled' : '') + '>'
          + btnTxt + '</button>'
          + '</div>';
      }

      // Rebuild the whole overlay from CURRENT wallet/levels each render so a
      // purchase repaints with the fresh $-balance and button-affordance states.
      function render() {
        bal = (eco && typeof eco.dollars === 'function') ? eco.dollars() : 0;
        lv = (eco && eco.store && eco.store.levels) || { tank: 0, engine: 0, rcs: 0, legs: 0 };
        // Wrap in .apollo-shop-inner so max-height + scroll apply; sticky exit at top.
        container.innerHTML =
          '<div class="apollo-shop-inner">'
        +   '<div class="sp-top">'
        +     '<button type="button" class="sp-close-top" data-k="close">✕ CLOSE HANGAR</button>'
        +     '<h2>MISSION HANGAR</h2>'
        +     '<div class="sp-sub">BUILD YOUR ROCKET — TANK · ENGINE · RCS · LEGS</div>'
        +     '<div class="sp-bal">WALLET &nbsp;$' + bal + '</div>'
        +   '</div>'
        +   buyRow('tank')
        +   buyRow('engine')
        +   buyRow('rcs')
        +   buyRow('legs')
        +   '<div class="sp-refuel"><div class="sp-refuel-row">'
        +   '<span class="rf-lbl">REFUEL STATION</span>'
        +   '<div class="rf-track"><div class="rf-fill" style="width:100%"></div></div>'
        +   '</div><div class="sp-desc" style="margin-top:6px">Tank refills free between missions. Bigger tanks hold more reserve.</div></div>'
        +   '<button type="button" class="sp-close" data-k="close2">RETURN TO BASE ▸</button>'
        + '</div>';
        wire();
        if (self._els && self._els.wal) self._els.wal.textContent = String(Math.floor(bal));
      }
      function bindClose(btn) {
        if (!btn) return;
        var go = function (ev) {
          if (ev && ev.cancelable) ev.preventDefault();
          if (ev && ev.stopPropagation) ev.stopPropagation();
          self._closeShop();
        };
        btn.onclick = go;
        btn.addEventListener('pointerup', go, { passive: false });
        btn.addEventListener('touchend', go, { passive: false });
      }
      function wire() {
        var buys = container.querySelectorAll('[data-buy]');
        Array.prototype.forEach.call(buys, function (b) {
          b.addEventListener('pointerup', function (ev) {
            if (ev && ev.stopPropagation) ev.stopPropagation();
            var id = b.getAttribute('data-buy');
            var res = eco.buy(id);
            if (res.ok) {
              if (window.Apollo.Audio && window.Apollo.Audio.cash) window.Apollo.Audio.cash();
              if (window.Apollo.Game) {
                eco.applyToConfig(window.Apollo.CFG, eco.store.levels);
                if (window.Apollo.State) window.Apollo.State.maxFuel = window.Apollo.CFG.maxFuel;
              }
              // Loop #2 complaint #4: re-render the 3D lander cosmetics live
              // as soon as an upgrade is bought, so the ship visibly changes.
              if (window.Apollo.Lander && window.Apollo.Lander.updateUpgrades) {
                window.Apollo.Lander.updateUpgrades(eco.store.levels);
              }
              render();
            }
          });
        });
        bindClose(container.querySelector('[data-k=close]'));
        bindClose(container.querySelector('[data-k=close2]'));
      }
      render();
    },

    /* ------------------------------------------------------ showTouch */
    /* Force pads on-screen for ms more (default 4s) regardless of status —
       game.js calls this on start so pads are never flash-and-vanish on
       iOS Safari even if the run ends quickly. */
    showTouch: function (ms) {
      this._touchGraceUntil = performance.now() + (ms != null ? ms : 4000);
      var e = this._els;
      if (e && e.touchL) e.touchL.classList.add('show');
      if (e && e.touchR) e.touchR.classList.add('show');
    },

    /* ---------------------------------------------------------------- destroy */
    destroy: function () {
      if (this.root && this.root.parentNode) {
        this.root.parentNode.removeChild(this.root);
      }
      this.root = null;
      this._els = null;
    }
  };

  /* ---- local helpers used by update ------------------------------------- */
  /* Reward/pay block injected into the verdict card (economy). $(lastReward). */
  function payHTML(state, kind) {
    var eco = window.Apollo.Economy;
    var rew = (state && state.lastReward) ? state.lastReward
            : (eco && eco.store && eco.store.lastReward) || { amount: 0, lines: [] };
    var amt = rew.amount || 0;
    var lbl = (kind === 'good')
      ? '<div class="vd-pay">+$' + amt + '</div><div class="vd-pay sub">MISSION PAY DEPOSITED TO WALLET</div>'
      : '<div class="vd-pay sub">IMPACT SALVAGE: +$' + amt + '</div>';
    // Terrain-graze thrill bonus earned mid-run (freegle idea #1).
    if (state && state.lastGraze && state.lastGraze.amount) {
      lbl += '<div class="vd-graze">TERRAIN GRAZE  +$' + state.lastGraze.amount + '</div>';
    }
    return lbl;
  }

  /* Refuel station bar (empty fill; animated by _runRefuel). */
  function refuelHTML() {
    return '<div class="vd-refuel"><div class="rf-fill"></div></div>';
  }

  function setRow(el_, danger, warnOnly) {
    var row = el_.closest ? el_.closest('.apollo-row') : null;
    if (!row) return;
    row.classList.remove('danger', 'warn');
    if (danger) row.classList.add('danger');
    else if (warnOnly) row.classList.add('warn');
  }

  window.Apollo.UI = UI;
})();
