# 🚗 JPJ Registration Number Picker

A tiny, static, offline-friendly web page to **browse available JPJ direct-purchase
vehicle registration numbers** and pick a nice one — without grinding through the
mySIKAP portal's 50-number-at-a-time search form.

**▶ Live:** https://chengkangzai.github.io/jpj-number-picker/

> Currently scoped to **JOHOR / JYY** (the current running series). It's a **snapshot**,
> refreshed occasionally — always re-verify on the official portal before buying.

---

## What it does

- Shows the full pool of numbers available for **direct purchase (fixed price)** in one
  searchable page.
- **Search** by digits or wildcards — `9249`, `92*`, `*44`, `9_4_`.
- **Filter** by pattern — double-ending (`..XX`), double-start (`XX..`), bookend (`X__X`),
  twin-middle (`_XX_`), triples.
- **Recommends** the most memorable numbers (mirrors, pairs, runs, low-distinct-digit),
  auto-scored.
- Click a plate → copy `JYY xxxx` to paste into mySIKAP when you buy.

No backend, no tracking, no account. Just `index.html` + an embedded number list.

## Why this exists

JPJ's mySIKAP "Tempahan No. Pendaftaran" form only lets you check **50 numbers per search**,
and the available numbers are scattered across the whole series. Finding a nice one by hand
is genuinely tedious. This flattens the whole pool into one page you can search instantly.

Note: JPJ keeps the **vanity numbers** (e.g. `8888`, `9696`, `9229`) out of direct purchase —
those are sold via **JPJeBid bidding** only. This tool covers the plain fixed-price pool.

## Refreshing the data (optional)

Two scripts, both **read-only** and bilingual (handle the English **and** Malay portal).
mySIKAP login requires an image captcha, so **you always log in yourself** — there is no
automated login and no captcha-solving anywhere in this repo.

### `jpj-daily.mjs` — assisted one-command refresh (recommended)

Opens a real browser at the mySIKAP login. You log in (IC + password + captcha, ~30s); the
script then scans the pool and rewrites the `<script id="poolData">` block in `index.html`.

```bash
npm install
npm run refresh
# or with options + auto commit/push:
JPJ_STATE=JOHOR JPJ_PREFIX=JYY JPJ_FROM=8700 JPJ_TO=9999 JPJ_GIT=1 npm run refresh
```

### `jpj-number-check.mjs` — cookie-based scanner / single-number checks

```bash
# Log in yourself, copy your Cookie header from DevTools, then:
JPJ_COOKIE='JSESSIONID=...; SID=...; ...' JPJ_STATE=JOHOR JPJ_PREFIX=JYY \
  JPJ_MODE=scan node jpj-number-check.mjs            # enumerate the pool
JPJ_COOKIE='...' JPJ_MODE=number JPJ_NUMBERS='9249,9259' node jpj-number-check.mjs   # check specific
```

No automated daily cron is included on purpose — the captcha keeps a human in the loop, which is
also the lowest-risk way to use it.

## How it works (the fun part)

mySIKAP is a [ZK Framework](https://www.zkoss.org/) app. There's no public API — its `/public/zkau`
endpoint is ZK's internal AU protocol (per-page-load component `uuid`s, a strictly sequential
`ZK-SID`, server-side desktop state). Replaying raw requests is brittle, so the scanner drives
the actual UI with Playwright instead. The "Range" search returns a grid of available numbers per
50-window, which the scanner walks across the series and de-duplicates into the pool you see here.

## Disclaimer

- **Not affiliated with JPJ** (Jabatan Pengangkutan Jalan Malaysia) or mySIKAP.
- Data is a **community snapshot** and may be out of date — numbers get bought. **Always verify
  on the official portal** (https://public.jpj.gov.my) before paying.
- Provided as-is, for convenience and educational purposes. Use your own account, respect the
  portal's terms, no warranty of any kind.

## License

[MIT](./LICENSE) — do whatever, no strings attached.
