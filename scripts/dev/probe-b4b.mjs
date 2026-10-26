import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4424 }, async ({ page, base }) => {
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
  // 多步拖动，确保 React 收到 move 序列
  const drag = async (u0,v0,u1,v1,steps=12) => {
    const a=toS(u0,v0), b=toS(u1,v1);
    await page.mouse.move(a.x,a.y); await page.mouse.down();
    for(let i=1;i<=steps;i++){ await page.mouse.move(a.x+(b.x-a.x)*i/steps, a.y+(b.y-a.y)*i/steps); await new Promise(r=>setTimeout(r,16)); }
    await page.mouse.up(); await new Promise(r=>setTimeout(r,350));
  };
  const stats = async (u0,v0,u1,v1) => page.evaluate(([g,a,b,c,d]) => {
    const cv = document.querySelector('.iso2d__canvas'); const ctx = cv.getContext('2d');
    const x0=Math.round(g.left+a*g.w), x1=Math.round(g.left+c*g.w);
    const y0=Math.round(g.top+b*g.h), y1=Math.round(g.top+d*g.h);
    const data=ctx.getImageData(x0,y0,Math.max(1,x1-x0),Math.max(1,y1-y0)).data;
    const L=[]; for(let i=0;i<data.length;i+=4) L.push(0.2126*data[i]+0.7152*data[i+1]+0.0722*data[i+2]);
    const mean=L.reduce((s,v)=>s+v,0)/L.length;
    const sd=Math.sqrt(L.reduce((s,v)=>s+(v-mean)**2,0)/L.length);
    return { mean:+mean.toFixed(1), sd:+sd.toFixed(2), range:+(Math.max(...L)-Math.min(...L)).toFixed(1) };
  }, [geom,u0,v0,u1,v1]);

  await resetAll();
  console.log('基准面       ', JSON.stringify(await stats(0.24,0.47,0.38,0.53)));
  await page.click('[data-testid="sandbox-tool-raise"]'); await new Promise(r=>setTimeout(r,250));
  for(let p=0;p<6;p++) await drag(0.18,0.5,0.42,0.5);
  await new Promise(r=>setTimeout(r,600));
  console.log('推6遍        ', JSON.stringify(await stats(0.24,0.47,0.38,0.53)));
  await page.click('[data-testid="sandbox-tool-dig"]'); await new Promise(r=>setTimeout(r,250));
  for(let p=0;p<6;p++) await drag(0.58,0.5,0.82,0.5);
  await new Promise(r=>setTimeout(r,600));
  console.log('挖6遍        ', JSON.stringify(await stats(0.62,0.47,0.78,0.53)));
  // 沙脊/沟交界处（真正的“纵向位移”应该在这里最明显）
  console.log('沙沟交界     ', JSON.stringify(await stats(0.40,0.44,0.60,0.56)));
});
process.exit(0);
