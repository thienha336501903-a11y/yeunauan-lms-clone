import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../legacy-post.html", import.meta.url), "utf8");
const css = page.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";

test("V4 and V5 intro share one visual shell without V5-only layout overrides", () => {
  assert.match(page, /\['lms',\s*'v4',\s*'v5'\]\.includes\(mode\)/);
  assert.doesNotMatch(css, /\[data-(?:delivery-)?mode=["']?v5/i);
  assert.doesNotMatch(css, /\.v5-(?:intro|legacy|course)/i);
  assert.doesNotMatch(css, /\bzoom\s*:/i);
});

test("shared intro shell allows grid and content children to shrink on mobile", () => {
  assert.match(css, /\.grid>\*\{min-width:0\}/);
  assert.match(css, /\.info\{[^}]*min-width:0[^}]*max-width:100%/);
  assert.match(css, /\.recipe\{[^}]*min-width:0[^}]*max-width:100%/);
  assert.match(css, /\.recipe-content\{[^}]*min-width:0[^}]*max-width:100%[^}]*overflow-wrap:anywhere/);
});

test("long released text and URLs wrap instead of widening the document", () => {
  assert.match(css, /\.recipe-content p,\.recipe-content li,\.recipe-content h3,\.v4-intro-item\{[^}]*overflow-wrap:anywhere[^}]*word-break:break-word/);
  assert.match(css, /\.title\{[^}]*overflow-wrap:anywhere/);
});

test("poster uses the same filled 4:3 visual geometry for V4 and V5", () => {
  assert.match(css, /\.media\{[^}]*aspect-ratio:4\/3/);
  assert.match(css, /\.media img\{[^}]*object-fit:cover/);
});

test("golden V4 entry nudge animation remains exact and shared", () => {
  assert.match(css, /animation:entryNudge 4\.8s \.15s ease-in-out infinite/);
  assert.match(css, /@keyframes entryNudge\{0%,16%,100%\{transform:translateY\(0\) scale\(1\)/);
  assert.match(css, /4%\{transform:translateY\(-2px\) rotate\(-\.35deg\) scale\(1\.018\)/);
  assert.match(css, /8%\{transform:translateY\(0\) rotate\(\.35deg\) scale\(1\.01\)/);
  assert.match(css, /12%\{transform:translateY\(-1px\) rotate\(-\.2deg\) scale\(1\.014\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.entry\{animation:none;transition:none\}\}/);
});

test("page keeps the original mobile viewport contract and V5 content flow", () => {
  assert.match(page, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(page, /Xem toàn bộ \$\{items\.length\} phần nội dung/);
  assert.match(page, /location\.assign\(`\/learning\?course=\$\{encodeURIComponent\(slug\)\}`\)/);
});
