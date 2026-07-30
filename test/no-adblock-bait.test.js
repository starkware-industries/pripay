// Guards against selectors that ad-blocker cosmetic filters hide.
//
// The transaction-detail modal used classes named `ad-grid` / `ad-lbl` / `ad-val`
// (short for "audit detail"). Filter lists hide `.ad-grid`, so for anyone running a
// blocker the modal opened, correctly populated, and rendered completely blank.
//
// It is a brutal bug to diagnose: the rule is injected at the user-stylesheet cascade
// origin, so it outranks even author `!important`; it does not appear in
// document.styleSheets, so page JS cannot see it; and nothing is logged. Confirmed by
// cloning the element with a neutral class name, at which point it rendered 327px tall.
//
// This test is a cheap tripwire so nobody reintroduces the pattern.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Matches the shapes filter lists actually target: an `ad` or `ads` segment used as a
// prefix or standalone token in a class/id. `add…`, `admin…` and `address…` are fine —
// the boundary is a separator or a capital letter, so `adName` trips but `addOrder`
// does not.
const BAIT = /\b(?:ad|ads|advert|banner|sponsor|promo)(?:-[a-z]|_[a-z]|[A-Z])/;

// Known-safe words that begin with the same letters.
const ALLOWED_PREFIXES = /^(?:add|admin|address|adapt|adjust)/i;

function selectorsFromHtml(html) {
  const out = new Set();
  for (const m of html.matchAll(/\b(?:class|id)="([^"]*)"/g)) {
    for (const tok of m[1].split(/\s+/)) if (tok) out.add(tok);
  }
  return out;
}

function selectorsFromCss(css) {
  const out = new Set();
  // Strip comments so the explanatory note above .txd-grid isn't scanned.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of stripped.matchAll(/[.#]([a-zA-Z][a-zA-Z0-9_-]*)/g)) out.add(m[1]);
  return out;
}

function offenders(names) {
  return [...names].filter((n) => !ALLOWED_PREFIXES.test(n) && BAIT.test(n));
}

test('the tripwire itself catches the pattern that broke the modal', () => {
  // Sanity-check the regex, so a future refactor can't quietly neuter this test.
  assert.deepStrictEqual(offenders(['ad-grid']), ['ad-grid']);
  assert.deepStrictEqual(offenders(['ad-lbl', 'adName', 'ads-box']), ['ad-lbl', 'adName', 'ads-box']);
  // ...and does not fire on legitimate names.
  assert.deepStrictEqual(offenders(['addOrderBtn', 'adminWalletsCard', 'address', 'txd-grid', 'txdName']), []);
});

for (const file of ['pripay/index.html', 'pripay/landing.html']) {
  test(`${file} has no ad-blocker-bait class or id`, () => {
    const found = offenders(selectorsFromHtml(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    assert.deepStrictEqual(found, [], `these are hidden for anyone running a blocker: ${found.join(', ')}`);
  });
}

test('styles.css has no ad-blocker-bait selector', () => {
  const found = offenders(selectorsFromCss(fs.readFileSync(path.join(ROOT, 'pripay/styles.css'), 'utf8')));
  assert.deepStrictEqual(found, [], `these are hidden for anyone running a blocker: ${found.join(', ')}`);
});

test('no source file looks up an ad-blocker-bait element id', () => {
  const dir = path.join(ROOT, 'src');
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
        if (!ALLOWED_PREFIXES.test(m[1]) && BAIT.test(m[1])) found.push(`${e.name}:${m[1]}`);
      }
    }
  };
  walk(dir);
  assert.deepStrictEqual(found, [], `these elements would be hidden by a blocker: ${found.join(', ')}`);
});
