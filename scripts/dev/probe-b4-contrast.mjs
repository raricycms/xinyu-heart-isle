import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4423 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1800));
  const geom = await page.evaluate(() => {
    const c = document.querySelector('.iso2d__canvas'); const r = c.getBoundingClientRect();
    const trayW = r.width*0.88, trayH = trayW*0.6;
    return { left: r.left + (r.width-trayW)/2, top: r.top + (r.height-trayH)/2 + trayH*0.08, w: trayW, h: trayH };
  });
  const toS = (u,v) => ({ x: geom.left + u*geom.w, y: geom.top + v*geom.h });
  const resetAll = async () => { await page.click('[data-testid="sandbox-tool-reset"]'); await new Promise(r=>setTimeout(r,320)); const c = await page.$('[data-testid="sandbox-tool-reset-confirm"]'); if(c) await c.click(); await new Promise(r=>setTimeout(r,700)); };
  const setR = async (id,v) => { await page.evaluate((i,x)=>{ const el=document.querySelector(`input[type=range][data-testid="${i}"]`); const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; s.call(el,String(x)); el.dispatchEvent(new Event('input',{bubbles:true})); },id,v); await new Promise(r=>setTimeout(r,130)); };
  const stats = async (u0,v0,u1,v1) => page.evaluate(([g,a,b,c,d]) => {
    const cv = document.querySelector('.iso2d__canvas'); const ctx = cv.getContext('2d');
    const x0 = Math.round(g.left+a*g.w), x1 = Math.round(g.left+c*g.w);
    const y0 = Math.round(g.top+b*g.h), y1 = Math.round(g.top+d*g.h);
    const data = ctx.getImageData(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0)).data;
    const lums=[]; for(let i=0;i<data.length;i+=4) lums.push(0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]);
    const mean=lums.reduce((s,v)=>s+v,0)/lums.length;
    const min=Math.min(...lums), max=Math.max(...lums);
    const sd=Math.sqrt(lums.reduce((s,v)=>s+(v-mean)**2,0)/lums.length);
    return { mean:+mean.toFixed(1), min:+min.toFixed(1), max:+max.toFixed(1), range:+(max-min).toFixed(1), sd:+sd.toFixed(2) };
  }, [geom,u0,v0,u1,v1]);

  await resetAll();
  console.log('基准面      ', JSON.stringify(await stats(0.24,0.47,0.38,0.53)));
  await page.click('[data-testid="sandbox-tool-raise"]'); await new Promise(r=>setTimeout(r,250));
  // 用默认滑杆（12/60）
  for (let p=0;p<6;p++) { const a=toS(0.18,0.5), b=toS(0.42,0.5); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y); await page.mouse.up(); await new Promise(r=>setTimeout(r,300)); }
  await new Promise(r=>setTimeout(r,600));
  console.log('推6遍(默认) ', JSON.stringify(await stats(0.24,0.47,0.38,0.53)));
  await resetAll();
  await setR('sandbox-tool-radius', 30); await setR('sandbox-tool-strength', 100);
  await page.click('[data-testid="sandbox-tool-raise"]'); await new Promise(r=>setTimeout(r,250));
  for (let p=0;p<6;p++) { const a=toS(0.18,0.5), b=toS(0.42,0.5); await page.mouse.move(a.x,a.y); await page.mouse.down(); await page.mouse.move(b.x,b.y); await page.mouse.up(); await new Promise(r=>setTimeout(r,300)); }
  await new Promise(r=>setTimeout(r,600));
  console.log('推6遍(大半径)', JSON.stringify(await stats(0.24,0.47,0.38,0.53)));
});
process.exit(0);
