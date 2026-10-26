import { withSandboxPage } from './harness.mjs';
await withSandboxPage({ port: 4405 }, async ({ page, base }) => {
  await page.goto(`${base}/sandbox`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const items = await page.$$('[data-testid="lib-item"]');
  await items[0].click();
  await new Promise((r) => setTimeout(r, 500));
  const out = await page.evaluate(() => {
    const insp = document.querySelector('.wb-inspector');
    const cs = getComputedStyle(insp);
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch { continue; }
      const walk = (ruleList, media) => {
        for (const rule of ruleList) {
          if (rule.media) { walk(rule.cssRules, rule.conditionText); continue; }
          if (!rule.selectorText) continue;
          if (!/wb-inspector/.test(rule.selectorText)) continue;
          if (!/width|position|inset|left|right|top|bottom/.test(rule.style.cssText)) continue;
          try { if (insp.matches(rule.selectorText)) rules.push(`${media ? '@media '+media+' ' : ''}${rule.selectorText} { ${rule.style.cssText} }`); } catch {}
        }
      };
      walk(list, null);
    }
    return { computedWidth: cs.width, computedPosition: cs.position, viewport: innerWidth, rules };
  });
  console.log(JSON.stringify(out, null, 2));
});
process.exit(0);
