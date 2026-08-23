#!/usr/bin/env node
/**
 * A/B performance comparison: benchmark two refs by alternating measurement rounds between them on
 * the same machine, so runner/noisy-neighbour offsets hit both sides equally and cancel out —
 * instead of comparing against a stored baseline measured on different hardware.
 *
 *   node tests/perf/ab.mjs --base master --head my-branch [options]
 *
 * Options:
 *   --rounds N        measurement rounds per side (default 5)
 *   --specs a,b       spec files to run: generation,interaction (default both)
 *   --threshold PCT   gate: fail if a gated metric's median slows by more than PCT% (default 25)
 *   --out DIR         output dir for results and comment.md (default .perf-ab/results)
 *   --keep            keep the worktrees for inspection
 *   --skip-install    reuse existing node_modules/build in the worktrees (dev iteration only)
 *
 * Gated metrics: generation totals and fixture load times, plus checksums — if both sides are
 * internally consistent but generate different maps from the same seed, head changed generation
 * output and the run fails. A side that disagrees with ITSELF is a pre-existing determinism bug
 * (upstream currently has one: cultures diverge on ~1/3 of runs) and is reported as a warning
 * rather than a failure, since it cannot be attributed to head. Interaction metrics (frame p95,
 * settle, layer draws) are reported as informational until their variance is calibrated with
 * base == head runs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = name => args.includes(`--${name}`);

const base = opt("base", "master");
const head = opt("head", "HEAD");
const rounds = Number(opt("rounds", "5"));
const specs = opt("specs", "generation,interaction").split(",").map(s => `tests/perf/${s.trim()}.spec.ts`);
const threshold = Number(opt("threshold", "25"));

const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const workRoot = path.join(repoRoot, ".perf-ab");
const outDir = path.resolve(opt("out", path.join(workRoot, "results")));
fs.mkdirSync(outDir, { recursive: true });

const run = (cmd, cmdArgs, cwd = repoRoot) => {
  const result = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(" ")} exited ${result.status}`);
};
const resolveRef = ref => execFileSync("git", ["rev-parse", "--short", ref], { cwd: repoRoot, encoding: "utf8" }).trim();

const sides = [
  { name: "base", ref: base, sha: resolveRef(base), repo: path.join(workRoot, "base", "repo") },
  { name: "head", ref: head, sha: resolveRef(head), repo: path.join(workRoot, "head", "repo") },
];

console.log(`A/B: base=${base} (${sides[0].sha})  head=${head} (${sides[1].sha})  rounds=${rounds}`);

for (const side of sides) {
  if (!flag("skip-install") || !fs.existsSync(side.repo)) {
    if (fs.existsSync(side.repo)) {
      run("git", ["worktree", "remove", "--force", side.repo]);
    }
    run("git", ["worktree", "add", "--force", "--detach", side.repo, side.sha]);
  }
  // Both sides run the measurement code from head, so the specs themselves are never part of the diff
  fs.mkdirSync(path.join(side.repo, "tests/perf"), { recursive: true });
  for (const file of ["playwright.config.ts", "generation.spec.ts", "interaction.spec.ts"]) {
    fs.copyFileSync(path.join(repoRoot, "tests/perf", file), path.join(side.repo, "tests/perf", file));
  }
  if (!flag("skip-install")) {
    console.log(`\n== npm ci + build: ${side.name} (${side.sha}) ==`);
    run("npm", ["ci", "--no-audit", "--no-fund"], side.repo);
    run("npm", ["run", "build"], side.repo);
  }
}

const results = { base: [], head: [] };

for (let round = 1; round <= rounds; round++) {
  // Alternate starting side each round so slow machine drift cannot systematically favour one side
  const order = round % 2 ? sides : [...sides].reverse();
  for (const side of order) {
    console.log(`\n== round ${round}/${rounds}: ${side.name} ==`);
    const outFile = path.join(outDir, `${side.name}-r${round}.jsonl`);
    fs.rmSync(outFile, { force: true });
    const pw = spawnSync("npx", ["playwright", "test", "-c", "tests/perf/playwright.config.ts", ...specs], {
      cwd: side.repo,
      stdio: "inherit",
      env: { ...process.env, SKIP_BUILD: "1", PERF_OUT: outFile },
    });
    if (pw.status !== 0) console.error(`WARNING: playwright exited ${pw.status} for ${side.name} round ${round}`);
    if (fs.existsSync(outFile)) {
      for (const line of fs.readFileSync(outFile, "utf8").split("\n").filter(Boolean)) {
        results[side.name].push(JSON.parse(line));
      }
    }
  }
}

// ---- aggregate ----

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

function metricKey(r) {
  if (r.kind === "generation") return `generation ${r.cells / 1000}K cells seed=${r.seed}`;
  if (r.kind === "load") return `load ${r.fixture}`;
  if (r.kind === "interaction") return `${r.preset}/${r.scenario}`;
  if (r.kind === "layer-draw") return `draw ${r.layer}`;
  return null;
}

function collect(records) {
  const metrics = new Map();
  const put = (key, value, gated) => {
    if (value == null) return;
    if (!metrics.has(key)) metrics.set(key, { values: [], gated });
    metrics.get(key).values.push(value);
  };
  for (const r of records) {
    const key = metricKey(r);
    if (r.kind === "generation") {
      put(`${key} :: totalMs`, r.totalMs, true);
      put(`${key} :: heapMB`, r.heapMB, false);
      for (const [stage, ms] of Object.entries(r.stages || {})) if (ms >= 50) put(`${key} :: ${stage}`, ms, false);
    }
    if (r.kind === "load") put(`${key} :: wallMs`, r.wallMs, true);
    if (r.kind === "interaction") {
      put(`${key} :: p95FrameMs`, r.p95FrameMs, false);
      put(`${key} :: settleMs`, r.settleMs, false);
      put(`${key} :: domNodes`, r.domNodes, false);
    }
    if (r.kind === "layer-draw" && r.drawMs >= 5) put(`${key} :: drawMs`, r.drawMs, false);
  }
  return metrics;
}

const baseMetrics = collect(results.base);
const headMetrics = collect(results.head);

// checksums: same seed+cells must hash identically on both sides, and within each side
const hashesFor = (side, key) =>
  new Set(
    results[side]
      .filter(r => r.kind === "generation" && `${r.cells}:${r.seed}` === key)
      .map(r => r.checksum?.hash)
  );
const checksumKeys = new Set(results.base.filter(r => r.kind === "generation").map(r => `${r.cells}:${r.seed}`));
const checksumIssues = []; // fail the run: both sides internally consistent, yet different maps
const checksumWarnings = []; // warn only: a side is nondeterministic with itself, so the diff cannot be attributed to head
for (const key of checksumKeys) {
  const baseHashes = hashesFor("base", key);
  const headHashes = hashesFor("head", key);
  if (baseHashes.size > 1 || headHashes.size > 1) {
    checksumWarnings.push(
      `\`${key}\`: same seed generated different maps within one side (base: ${[...baseHashes]}, head: ${[...headHashes]}) — a generation determinism bug, timings are noisier than they look`
    );
  } else if ([...baseHashes][0] !== [...headHashes][0]) {
    checksumIssues.push(`\`${key}\`: base and head deterministically generate different maps (${[...baseHashes]} vs ${[...headHashes]}) — head changes generation output; timings for this seed are not comparable`);
  }
}

// ---- report ----

const rows = [];
let gateFailed = false;
for (const [key, { values, gated }] of baseMetrics) {
  const headEntry = headMetrics.get(key);
  if (!headEntry) continue;
  const baseMedian = median(values);
  const headMedian = median(headEntry.values);
  if (baseMedian == null || headMedian == null || baseMedian === 0) continue;
  const deltaPct = ((headMedian - baseMedian) / baseMedian) * 100;
  const tripped = gated && deltaPct > threshold;
  if (tripped) gateFailed = true;
  rows.push({ key, gated, baseMedian, headMedian, deltaPct, tripped });
}

const fmt = n => (n >= 100 ? Math.round(n).toString() : n.toFixed(1));
const table = list =>
  ["| metric | base | head | Δ |", "|---|---:|---:|---:|",
    ...list.map(r => `| ${r.tripped ? "🔴 " : ""}${r.key} | ${fmt(r.baseMedian)} | ${fmt(r.headMedian)} | ${r.deltaPct >= 0 ? "+" : ""}${r.deltaPct.toFixed(1)}% |`),
  ].join("\n");

const gatedRows = rows.filter(r => r.gated);
const infoRows = rows.filter(r => !r.gated).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

const lines = [
  `## Performance A/B: \`${base}\` vs \`${head}\``,
  ``,
  `${rounds} alternating rounds per side, medians compared, gate at +${threshold}%.`,
  ``,
  checksumIssues.length ? `### 🔴 Checksum failures\n\n${checksumIssues.map(issue => `- ${issue}`).join("\n")}\n` : "",
  checksumWarnings.length ? `### ⚠️ Determinism warnings\n\n${checksumWarnings.map(warning => `- ${warning}`).join("\n")}\n` : "",
  `### Gated`,
  ``,
  table(gatedRows),
  ``,
  `<details><summary>Informational (${infoRows.length} metrics)</summary>`,
  ``,
  table(infoRows),
  ``,
  `</details>`,
].filter(Boolean);

const comment = lines.join("\n");
fs.writeFileSync(path.join(outDir, "comment.md"), comment);
console.log(`\n${comment}\n`);
console.log(`Results: ${outDir}`);

if (!flag("keep")) {
  for (const side of sides) run("git", ["worktree", "remove", "--force", side.repo]);
}

if (checksumWarnings.length) console.warn("WARNING: generation is nondeterministic (see report)");
if (checksumIssues.length || gateFailed) {
  console.error(checksumIssues.length ? "FAILED: checksum mismatch" : `FAILED: gated metric slower than +${threshold}%`);
  process.exit(1);
}
console.log("PASSED");
