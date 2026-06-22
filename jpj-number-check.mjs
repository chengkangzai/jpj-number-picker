#!/usr/bin/env node
/**
 * JPJ mySIKAP — Direct-Purchase Registration Number tool (availability + pool scan).
 *
 * No official JPJ API exists; /public/zkau is ZK's internal AU protocol
 * (per-desktop uuids, sequential ZK-SID) — not a stable surface. So we puppet
 * the real UI with Playwright using your logged-in session cookies.
 *
 * Path reproduced: Vehicle/Kenderaan ▸ Reserved Registration No. (direct
 * purchase, fixed price) ▸ Kategori Siri = "Nombor Pendaftaran Semasa" ▸
 * State ▸ Serial Prefix ▸ mode (Number | Range/Julat 50) ▸ Search/Cari.
 *
 * VERIFIED FACTS about the form:
 *   - Portal may render in English OR Malay — selectors below are bilingual.
 *   - "Number" mode  -> single z-intbox, result is a modal:
 *       "Reserved No. does not exist." = taken / not in direct pool (bid-only).
 *   - "Range" mode   -> TWO z-intboxes (from,to), max span 50; result is a grid
 *       LISTING the available numbers in that window. After a search the form
 *       navigates to a results view, so each window needs a fresh setup.
 *   - JPJ keeps vanity numbers (ABBA/AABB/repeats/etc.) OUT of direct purchase
 *       (reserved for JPJeBid) — the direct pool is plain leftover numbers.
 *
 * MODES (env JPJ_MODE):
 *   number (default) — check each number in JPJ_NUMBERS (modal verdict).
 *   scan             — Range-scan JPJ_FROM..JPJ_TO in 50-windows, print the full
 *                      available pool + flag nice patterns.
 *
 * USAGE:
 *   1. Log into https://public.jpj.gov.my, copy the full Cookie header
 *      (DevTools ▸ Network ▸ any zkau request ▸ Request Headers ▸ cookie).
 *   2. npm i playwright   (once)
 *   3a. JPJ_COOKIE='...' JPJ_STATE=JOHOR JPJ_PREFIX=JYY JPJ_NUMBERS='9249,9259' \
 *         node jpj-number-check.mjs
 *   3b. JPJ_COOKIE='...' JPJ_STATE=JOHOR JPJ_PREFIX=JYY JPJ_MODE=scan \
 *         JPJ_FROM=8794 JPJ_TO=9999 node jpj-number-check.mjs
 *
 * Cookies expire FAST (mySIKAP desktop timeout) — refresh JPJ_COOKIE when it
 * bounces to login. READ-ONLY: never confirms a purchase.
 */
import { chromium } from 'playwright';

const COOKIE  = process.env.JPJ_COOKIE || '';
const STATE   = process.env.JPJ_STATE  || 'JOHOR';
const PREFIX  = process.env.JPJ_PREFIX || 'JYY';
const MODE    = (process.env.JPJ_MODE || 'number').toLowerCase();
const NUMBERS = (process.env.JPJ_NUMBERS || '9249,9259,9349').split(',').map(s=>s.trim()).filter(Boolean);
const FROM    = parseInt(process.env.JPJ_FROM || '8794', 10);
const TO      = parseInt(process.env.JPJ_TO   || '9999', 10);
const HEADLESS = process.env.JPJ_HEADFUL ? false : true;
const URL = 'https://public.jpj.gov.my/public/index.zul';

if (!COOKIE) { console.error('Set JPJ_COOKIE (full Cookie header for public.jpj.gov.my).'); process.exit(1); }

// bilingual label regexes (English | Malay)
const L = {
  vehicle:   /^(Vehicle|Kenderaan)$/,
  directBuy: /(direct purchase of registration|pembelian terus no\. pendaftaran)/i,
  kategori:  /Kategori Siri/i,
  state:     /(State \/ Area|Negeri \/ Kawasan)/i,
  prefix:    /(Serial Prefix|Siri Awalan)/i,
  numberRow: /(^\*?\s*Number\s*:|^\*?\s*Nombor\s*:)/i,
  rangeOpt:  /(Range|Julat)/i,
  numberOpt: /^(Number|Nombor)$/,
  semasa:    /Nombor Pendaftaran Semasa/i,
  search:    /^(Search|Cari)$/,
};

const cookieArr = (h, domain) => h.split(';').map(p=>p.trim()).filter(Boolean).map(p=>{
  const i=p.indexOf('='); return {name:p.slice(0,i), value:p.slice(i+1), domain, path:'/'};
});

(async () => {
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({ userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36' });
  await ctx.addCookies(cookieArr(COOKIE, 'public.jpj.gov.my'));
  const page = await ctx.newPage();
  const sleep = ms => page.waitForTimeout(ms);

  async function widFor(rx) {
    return page.evaluate(src => {
      const vis = el => el && el.offsetParent !== null;
      const re = new RegExp(src, 'i');
      for (const cb of document.querySelectorAll('.z-combobox-rounded,.z-combobox')) {
        if (!vis(cb)) continue;
        const tr = cb.closest('tr');
        const lbl = tr ? (tr.querySelector('td')?.innerText.trim() || '') : '';
        if (re.test(lbl)) return cb.id;
      }
      return null;
    }, rx.source);
  }
  async function pickById(wid, itemRx) {
    await page.locator(`#${wid}-btn`).click();
    await sleep(400);
    const it = page.locator(`#${wid}-pp .z-comboitem`).filter({ hasText: itemRx }).first();
    await it.waitFor({ state:'visible', timeout:6000 });
    await it.click();
    await sleep(950);
  }
  async function gotoForm() {
    await page.goto(URL, { waitUntil:'domcontentloaded' });
    await sleep(900);
    if (/login\.zul/.test(page.url())) throw new Error('session expired');
    await page.locator('#wrap').getByText(L.vehicle).first().click();
    await sleep(1300);
    await page.getByText(L.directBuy).first().click();
    await sleep(1800);
  }
  async function setup(modeRx) {
    await pickById(await widFor(L.kategori), L.semasa);
    await pickById(await widFor(L.state), new RegExp(`^${STATE}$`,'i'));
    await pickById(await widFor(L.prefix), new RegExp(`^${PREFIX}`,'i'));
    await pickById(await widFor(L.numberRow), modeRx);
  }
  async function typeBox(id, v) {
    const b = page.locator('#'+id);
    await b.click(); await b.press('Control+a'); await b.press('Delete');
    await b.pressSequentially(String(v), { delay:45 }); await b.blur(); await sleep(250);
  }

  // ---- single-number check (modal verdict) ----
  async function checkNumber(num) {
    await gotoForm();
    await setup(L.numberOpt);
    const id = await page.evaluate(() => [...document.querySelectorAll('input.z-intbox')].find(e=>e.offsetParent!==null)?.id);
    await typeBox(id, num);
    await page.getByRole('button', { name: L.search }).click();
    await sleep(2000);
    const v = await page.evaluate(() => {
      let t=''; const vis=el=>el&&el.offsetParent!==null;
      document.querySelectorAll('.z-window-modal,.z-window').forEach(w=>{ if(vis(w)){const o=w.innerText.replace(/\s+/g,' ').trim(); if(o)t=o;} });
      return t.replace(/\s*(Close|Tutup)\s*$/i,'').trim();
    });
    return v || '(no verdict)';
  }

  // ---- range window -> available numbers in [from,to] (<=50 span) ----
  async function scanWindow(from, to) {
    await gotoForm();
    await setup(L.rangeOpt);
    const ids = await page.evaluate(() => [...document.querySelectorAll('input.z-intbox')].filter(e=>e.offsetParent!==null).map(e=>e.id));
    await typeBox(ids[0], from);
    await typeBox(ids[1], to);
    await page.getByRole('button', { name: L.search }).click();
    await sleep(2300);
    return page.evaluate(() => {
      const vis=el=>el&&el.offsetParent!==null;
      const txt=[...document.querySelectorAll('.z-grid,.z-listbox')].filter(vis).map(g=>g.innerText).join(' ');
      return [...new Set((txt.match(/\b\d{3,4}\b/g)||[]))].map(Number);
    });
  }

  const nice = n => {
    const d = String(n).padStart(4,'0').split('').map(Number); const [a,b,c,e]=d;
    if (a===b&&b===c&&c===e) return 'AAAA';
    if (a===e&&b===c) return 'ABBA';
    if (a===b&&c===e) return 'AABB';
    if (a===c&&b===e) return 'ABAB';
    if ((a===b&&b===c)||(b===c&&c===e)) return 'AAA';
    if (c===e) return '..XX';
    if (a===b) return 'XX..';
    if (a===e) return 'X..X';
    return '';
  };

  if (MODE === 'scan') {
    const pool = new Set();
    for (let f=FROM; f<=TO; f+=50) {
      const a=f, b=Math.min(f+49, TO);
      try { const nums = await scanWindow(a,b); nums.forEach(n=>pool.add(n)); process.stderr.write(`  ${a}-${b}: ${nums.length}\n`); }
      catch (e) { process.stderr.write(`  ${a}-${b}: ERR ${e.message}\n`); if (/expired/.test(e.message)) break; }
    }
    const all=[...pool].sort((x,y)=>x-y);
    console.log(`\nJPJ direct-purchase pool — ${STATE} / ${PREFIX}  (${all.length} numbers, ${FROM}-${TO})`);
    console.log('-'.repeat(60));
    console.log(all.map(n=>`${PREFIX} ${n}`).join('  '));
    const niceList = all.map(n=>[n,nice(n)]).filter(([,p])=>p);
    if (niceList.length) {
      console.log('\nNice patterns available:');
      for (const [n,p] of niceList) console.log(`  ${PREFIX} ${n}  [${p}]`);
    } else console.log('\n(no patterned numbers — JPJ reserves those for JPJeBid bidding)');
  } else {
    const res = {};
    for (const n of NUMBERS) { try { res[`${PREFIX} ${n}`]=await checkNumber(n); } catch(e){ res[`${PREFIX} ${n}`]='ERR: '+e.message.slice(0,50); } }
    console.log(`\nJPJ direct-purchase availability — ${STATE} / ${PREFIX}\n`+'-'.repeat(48));
    for (const [k,v] of Object.entries(res)) console.log(`${k.padEnd(12)} ${v}`);
  }
  await browser.close();
})();
