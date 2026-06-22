#!/usr/bin/env node
/**
 * jpj-daily.mjs — assisted daily refresh for the JPJ Number Picker.
 *
 * Opens a REAL browser window at the mySIKAP login. YOU log in yourself
 * (IC + password + the image captcha) — there is no automated login and no
 * captcha-solving here, by design. Once you're in, the script takes over,
 * scans the available direct-purchase pool for one state/series, and rewrites
 * the <script id="poolData"> block inside index.html so the page is fresh.
 *
 * Human effort: ~30 seconds (the login). The rest is automated.
 *
 *   npm install
 *   JPJ_STATE=JOHOR JPJ_PREFIX=JYY JPJ_FROM=8700 JPJ_TO=9999 node jpj-daily.mjs
 *   # then:  git commit -am "refresh pool" && git push
 *   # or set JPJ_GIT=1 to auto commit+push.
 *
 * READ-ONLY against JPJ. Personal use. Respect the portal's terms. Not
 * affiliated with JPJ / mySIKAP.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const STATE  = process.env.JPJ_STATE  || 'JOHOR';
const PREFIX = process.env.JPJ_PREFIX || 'JYY';
const FROM   = parseInt(process.env.JPJ_FROM || '8700', 10);
const TO     = parseInt(process.env.JPJ_TO   || '9999', 10);
const HTML   = process.env.JPJ_HTML  || new URL('./index.html', import.meta.url).pathname;
const DOGIT  = !!process.env.JPJ_GIT;
const LOGIN  = 'https://public.jpj.gov.my/public/login.zul';
const HOME   = 'https://public.jpj.gov.my/public/index.zul';

const L = {
  vehicle:   /^(Vehicle|Kenderaan)$/,
  directBuy: /(direct purchase of registration|pembelian terus no\. pendaftaran)/i,
  kategori:  /Kategori Siri/i,
  state:     /(State \/ Area|Negeri \/ Kawasan)/i,
  prefix:    /(Serial Prefix|Siri Awalan)/i,
  numberRow: /(^\*?\s*Number\s*:|^\*?\s*Nombor\s*:)/i,
  rangeOpt:  /(Range|Julat)/i,
  semasa:    /Nombor Pendaftaran Semasa/i,
  search:    /^(Search|Cari)$/,
  loggedIn:  /(Log Out|Log Keluar)/,
};

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const sleep = ms => page.waitForTimeout(ms);

  console.log('\n  Opening mySIKAP login…');
  console.log('  → Log in yourself (IC + password + captcha) in the browser window.');
  console.log('  → I will continue automatically once you are logged in.\n');
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded' });

  // wait (up to 5 min) for the human to finish login — detected by the logout link
  await page.waitForFunction(() => /Log Out|Log Keluar/.test(document.body.innerText), null, { timeout: 300000 });
  console.log('  ✓ Logged in. Scanning ' + STATE + ' / ' + PREFIX + ' (' + FROM + '–' + TO + ')…\n');

  async function widFor(re){
    return page.evaluate(s => {
      const vis = el => el && el.offsetParent !== null;
      const rx = new RegExp(s, 'i');
      for (const cb of document.querySelectorAll('.z-combobox-rounded,.z-combobox')) {
        if (!vis(cb)) continue;
        const tr = cb.closest('tr'); const lbl = tr ? (tr.querySelector('td')?.innerText.trim() || '') : '';
        if (rx.test(lbl)) return cb.id;
      }
      return null;
    }, re.source);
  }
  async function pick(wid, re){
    await page.locator(`#${wid}-btn`).click(); await sleep(420);
    const it = page.locator(`#${wid}-pp .z-comboitem`).filter({ hasText: re }).first();
    await it.waitFor({ state:'visible', timeout:6000 }); await it.click(); await sleep(950);
  }
  async function gotoForm(){
    await page.goto(HOME, { waitUntil:'domcontentloaded' }); await sleep(900);
    if (/login\.zul/.test(page.url())) throw new Error('session expired');
    await page.locator('#wrap').getByText(L.vehicle).first().click(); await sleep(1300);
    await page.getByText(L.directBuy).first().click(); await sleep(1800);
  }
  async function scanWindow(from, to){
    await gotoForm();
    await pick(await widFor(L.kategori), L.semasa);
    await pick(await widFor(L.state), new RegExp(`^${STATE}$`,'i'));
    await pick(await widFor(L.prefix), new RegExp(`^${PREFIX}`,'i'));
    await pick(await widFor(L.numberRow), L.rangeOpt);
    const ids = await page.evaluate(() => [...document.querySelectorAll('input.z-intbox')].filter(e=>e.offsetParent!==null).map(e=>e.id));
    async function tb(id,v){ const b=page.locator('#'+id); await b.click(); await b.press('Control+a'); await b.press('Delete'); await b.pressSequentially(String(v),{delay:40}); await b.blur(); await sleep(220); }
    await tb(ids[0], from); await tb(ids[1], to);
    await page.getByRole('button', { name: L.search }).click(); await sleep(2300);
    return page.evaluate(() => {
      const vis = el => el && el.offsetParent !== null;
      const txt = [...document.querySelectorAll('.z-grid,.z-listbox')].filter(vis).map(g=>g.innerText).join(' ');
      return [...new Set((txt.match(/\b\d{3,4}\b/g)||[]))].map(Number);
    });
  }

  const pool = new Set();
  for (let f=FROM; f<=TO; f+=50) {
    const a=f, b=Math.min(f+49, TO);
    try { const nums = await scanWindow(a,b); nums.forEach(n=>pool.add(n)); console.log(`    ${a}-${b}: ${nums.length}`); }
    catch (e) { console.log(`    ${a}-${b}: ERR ${e.message}`); if (/expired/.test(e.message)) break; }
  }
  await browser.close();

  const numbers = [...pool].sort((x,y)=>x-y);
  if (!numbers.length) { console.error('\n  No numbers scanned — aborting (page left unchanged).'); process.exit(1); }
  const counter = numbers[0];
  const updated = new Date().toISOString().slice(0,10);
  const data = { state: STATE, series: PREFIX, counter, updated, numbers };

  // rewrite the <script id="poolData"> block in index.html
  let html = readFileSync(HTML, 'utf8');
  const re = /(<script id="poolData" type="application\/json">)[\s\S]*?(<\/script>)/;
  if (!re.test(html)) { console.error('  Could not find poolData block in ' + HTML); process.exit(1); }
  html = html.replace(re, `$1\n${JSON.stringify(data)}\n$2`);
  writeFileSync(HTML, html);
  console.log(`\n  ✓ Wrote ${numbers.length} numbers (counter ${counter}, ${updated}) into index.html`);

  if (DOGIT) {
    try {
      execSync(`git add "${HTML}" && git commit -m "refresh ${STATE}/${PREFIX} pool ${updated}" && git push`, { stdio:'inherit' });
      console.log('  ✓ Committed & pushed.');
    } catch (e) { console.error('  git step failed — commit manually.'); }
  } else {
    console.log('  → Review, then:  git commit -am "refresh pool" && git push');
  }
})();
