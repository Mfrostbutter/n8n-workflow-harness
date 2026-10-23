// Headless zoom-to-fit screenshots of n8n workflows.
// Usage: node shoot.js <outdir> <key=workflowId> [key=workflowId...]
// Env:   N8N_BASE   (default http://localhost:5690)
//        N8N_COOKIE path to a file holding the n8n-auth cookie value (default ./.n8n-cookie)
//        CHROME     path to a Chromium binary (default: playwright-core's bundled lookup)
// Get the cookie once, never via a typed password:
//   curl -s -c cj.txt -X POST $N8N_BASE/rest/login -H 'Content-Type: application/json' \
//        -d @login.json   &&   awk '/n8n-auth/{print $7}' cj.txt > .n8n-cookie
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.N8N_BASE || 'http://localhost:5690';
const COOKIE_FILE = process.env.N8N_COOKIE || path.join(process.cwd(), '.n8n-cookie');
const EXE = process.env.CHROME || undefined;

(async () => {
  const [outdir, ...pairs] = process.argv.slice(2);
  if (!outdir || !pairs.length) { console.error('usage: node shoot.js <outdir> <key=id> ...'); process.exit(2); }
  fs.mkdirSync(outdir, { recursive: true });
  const cookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim();
  const host = new URL(BASE).hostname;
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'n8n-auth', value: cookie, domain: host, path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  for (const p of pairs) {
    const [key, id] = p.split('=');
    await page.goto(`${BASE}/workflow/${id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape');       // dismiss callouts
    await page.mouse.click(960, 540);          // focus the canvas
    await page.waitForTimeout(300);
    await page.keyboard.press('1');            // zoom to fit
    await page.waitForTimeout(1200);
    const file = path.join(outdir, `${key}-fit.png`);
    await page.screenshot({ path: file });
    console.log(key, file);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
