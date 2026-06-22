# How this was built — reverse-engineering a government ZK app

A walkthrough of turning a clunky, API-less government portal into a clean static
tool. Written as a teaching piece: the interesting part isn't the result, it's the
chain of dead-ends and the gotchas that each one taught.

> **Ethics first.** Everything here is read-only, runs under *your own* login, at
> human pace, and never defeats a security control (see [The captcha wall](#7-the-captcha-wall)).
> It's a personal-convenience + learning project. Not affiliated with JPJ.

---

## 1. The problem

JPJ's mySIKAP portal sells "running" vehicle registration numbers at a fixed price.
But the search form only checks **50 numbers at a time**, and the available numbers
are scattered across a 1,000+ range. Finding a memorable one by hand is miserable.
Goal: see the whole available pool on one searchable page.

## 2. Is there an API? (No.)

First instinct — find the JSON endpoint. There isn't one. The network tab shows every
interaction POSTing to `/public/zkau` with a body like:

```
dtid=z_s370&cmd_0=onChange&uuid_0=o4JB76&data_0={"value":9000,"start":4}&...
```

That's **ZK Framework**'s internal "AU" (asynchronous update) protocol — the framework's
own client ↔ server channel, not a public API.

## 3. Why you can't just replay the request

Replaying that `curl` returns `{"rs":[]}` — empty. ZK's protocol is stateful and hostile
to replay:

| field | behavior | consequence |
|-------|----------|-------------|
| `dtid` (desktop id) | new on **every page load** (`z_s370`→`z_t370`→…) | can't hardcode |
| `uuid_*` (component ids) | minted per desktop | must be scraped live each session |
| `ZK-SID` header | must be **strictly sequential** | out-of-order → silently ignored (the empty `rs`) |

Lesson: an empty `{"rs":[]}` from ZK usually means *desync*, not *no data*. The moment I
sent an **in-sequence** `ZK-SID`, the same request returned real commands — including a
server stack trace (see next).

## 4. The error that revealed the field types

Sending the number as a bare integer threw a 500 with this trace:

```
java.lang.Integer incompatible with java.lang.String
  org.zkoss.zul.Combobox.coerceToString(Combobox.java:105)
```

That single line told me the from/to fields were server-side **Comboboxes** expecting
strings, not raw ints — invaluable for understanding the form without any docs. Reading
the framework's own exception is often faster than guessing.

## 5. Pivot: drive the real UI instead

Hand-crafting ZK AU requests is too brittle (per-desktop uuids, sequential SIDs, modal
state). So: **drive the actual browser UI with Playwright**, using the session cookies.

```js
await ctx.addCookies(cookieArr(COOKIE, 'public.jpj.gov.my')); // httpOnly → can't set via JS
await page.goto('https://public.jpj.gov.my/public/index.zul');
```

Now ZK's own client handles the protocol; I just click like a human.

## 6. The gotchas (the actual content of the project)

Each of these was a real dead-end that taught something:

- **ZK intbox ignores `fill()`.** Setting `.value` doesn't fire ZK's `onChange`, so the
  server sees an empty field → *"Please enter a number."* Fix: real keystrokes via
  `pressSequentially()` + `blur()`.
- **Comboboxes have inconsistent theme classes** — one field is `z-combobox-rounded`,
  the next is plain `z-combobox`. Selecting by class is fragile; drive by widget id
  (`#wid-btn` to open, `#wid-pp` for the popup) instead.
- **Stale widgets linger in the DOM.** Old pages' hidden comboboxes stay around; every
  query must filter `offsetParent !== null` (visible-only).
- **Modal "Close" vs form "Clear".** The result dialog's button is *Close*; the form has
  a separate *Clear* that **resets everything**. Clicking the wrong one silently wiped the
  form mid-loop. Easy to conflate; painful to debug.
- **A failed search resets the form**, so each 50-window scan re-navigates and re-selects
  from scratch. Annoying but deterministic.
- **"Number" mode = one intbox + modal verdict; "Range" mode = two intboxes + a results
  grid** that *lists* the available numbers. The grid is the key to enumerating the pool.
- **The portal renders in English *or* Malay** depending on session. Selectors had to be
  bilingual (`Vehicle|Kenderaan`, `Search|Cari`, …).
- **Sessions die fast** (a few minutes of desktop idle), so anything long-running must
  tolerate re-login.

## 7. Finding the pool

In "Range" mode, searching `8750–8799` returned a grid containing just `8794, 8795`. That
located the **current counter (8794)** — everything below is already issued. Walking the
whole series in 50-wide windows and de-duplicating the grids yields the full pool (~332
plain numbers). A useful realization: JPJ keeps all the *vanity* numbers out of direct
purchase (they go to JPJeBid bidding), so the direct pool is deliberately the plain ones.

## 8. The captcha wall (and why I stopped there)

mySIKAP login is IC + password + a distorted-text **image captcha**. That's the hard stop
for unattended automation — and intentionally so. Building an OCR/solver would (a) defeat
an authentication control and (b) legally upgrade the whole thing from "harmless hobby
scraper" to "circumvented a security mechanism."

So the design keeps a **human in the loop**: `jpj-daily.mjs` opens a real browser, *you*
log in (~30s), and only then does the script take over. No solver, no stored credentials,
no cron. The friction is the feature.

## 9. Shipping

- Static `index.html` with the pool embedded in a regenerable `<script type="application/json">`
  block — no backend, works offline, hosts free on GitHub Pages.
- `jpj-daily.mjs` rewrites only that data block, so a refresh touches data, not markup.
- Snapshot date shown in the UI so nobody mistakes it for live data.

## What this demonstrates

- **Reverse-engineering** an undocumented stateful protocol from traffic + error messages.
- **Browser automation** resilient to a hostile, stateful, bilingual legacy UI.
- **Judgment**: knowing where to *stop* (the captcha) — the security and legal reasoning
  matters as much as the code.
- **Shipping**: a real, hosted, documented artifact — not just a script in a gist.

The takeaway I'd want a reader to keep: the value wasn't a plate number. It was reading a
framework's own error messages, respecting a boundary on purpose, and finishing the thing.
