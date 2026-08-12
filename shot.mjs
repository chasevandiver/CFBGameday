import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [theme, file] of [['dark','pv-dark'],['light','pv-light']]) {
  const p = await b.newPage({ viewport: { width: 420, height: 1100 }, deviceScaleFactor: 2 });
  await p.addInitScript(t => { try { localStorage.setItem('slate-theme', t); } catch {} }, theme);
  await p.goto('http://localhost:3111/slate/preview', { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `/tmp/${file}.png` });
  await p.close();
}
await b.close();
console.log('ok');
