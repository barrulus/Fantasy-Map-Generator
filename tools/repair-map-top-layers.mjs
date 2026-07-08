#!/usr/bin/env node
// Repair an FMG .map file that crashes stock/upstream Azgaar on load with:
//   TypeError: Cannot read properties of null (reading 'style')
//     at invokeActiveZooming (main.js:...)   // labels.style("display")
//
// Cause: this fork's LayerHost compositor (labels-to-GPU work) moves the top SVG layers
// (labels, markers, ruler, armies, fogging, debug, addedLabels) out of #map into a sibling
// #mapTop overlay when the WebGL burg layer is active. Saves made before the save-side fix
// cloned only #map, so those groups were never serialized. Upstream then binds
// `labels = viewbox.select("#labels")` -> empty selection, and invokeActiveZooming() calls
// `labels.style("display")` (a d3 GETTER on a null node) -> crash. `ruler` and `markers`
// are dereferenced the same way right after.
//
// The layer CONTENT is genuinely gone from these files (it lived in #mapTop, which was never
// written). This tool can only inject empty stub groups so the file LOADS without crashing —
// labels/markers/ruler will be blank in the loaded map. Files saved after the code fix keep
// full content and don't need this. Idempotent: skips groups already present, and leaves a
// file that already has them byte-for-byte unchanged.
//
// Usage: node tools/repair-map-top-layers.mjs <in.map> [out.map]
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2];
const OUT = process.argv[3] || SRC?.replace(/\.map$/, "") + ".repaired.map";
if (!SRC) {
  console.error("usage: node tools/repair-map-top-layers.mjs <in.map> [out.map]");
  process.exit(1);
}

// latin1 = 1:1 byte<->char so non-SVG sections survive untouched. FMG sections are
// CRLF-delimited; the SVG itself uses LF internally (see load.ts parseLoadedResult).
const text = readFileSync(SRC, "latin1");
const sections = text.split("\r\n");
if (sections.length < 6) throw new Error(`unexpected section count: ${sections.length} (not a Full .map export?)`);

let svg = sections[5];
if (!/<g id="viewbox"[^>]*>/.test(svg)) throw new Error("no #viewbox group found in SVG section (index 5)");

// The top layers upstream expects (and dereferences unguarded). Order mirrors main.js setup.
// Empty stubs: z-order is irrelevant since there is no content to render.
const GROUPS = [
  ["labels", '<g id="labels"><g id="states"></g><g id="burgLabels"></g></g>'],
  ["armies", '<g id="armies"></g>'],
  ["markers", '<g id="markers"></g>'],
  ["fogging", '<g id="fogging" display="none"></g>'],
  ["ruler", '<g id="ruler" style="display: none;"></g>'],
  ["debug", '<g id="debug"></g>'],
  ["addedLabels", '<g id="addedLabels"></g>']
];

const injected = [];
const stubs = GROUPS.filter(([id]) => !new RegExp(`id="${id}"`).test(svg)).map(([id, html]) => {
  injected.push(id);
  return html;
});

if (!stubs.length) {
  console.log(`${SRC}: all top layers already present — no changes needed.`);
  process.exit(0);
}

// Insert the stubs as the first children of #viewbox (they are empty, so position is cosmetic;
// upstream selects them by id regardless of order).
svg = svg.replace(/(<g id="viewbox"[^>]*>)/, `$1${stubs.join("")}`);
sections[5] = svg;
writeFileSync(OUT, sections.join("\r\n"), "latin1");

console.log(`injected stub groups: ${injected.join(", ")}`);
console.log(`wrote ${OUT}`);
