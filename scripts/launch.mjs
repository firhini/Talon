#!/usr/bin/env node
/**
 * TALON one-click launcher (plain Node, no dependencies).
 *   node scripts/launch.mjs        (or talon.sh / talon.bat / npm start)
 * Checks Node, installs dependencies, builds what is stale, prepares data/ and .env, starts the production
 * dashboard and opens it in the browser. Ctrl+C stops the dashboard and asks it to stop the bot (the bot keeps
 * its open position and exchange stop orders; nothing is flattened).
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TALON_PORT || process.env.PORT || 3000);
const URL_ = `http://localhost:${PORT}`;
const WIN = process.platform === "win32";
const log = (s) => console.log(`[talon] ${s}`);
const die = (s) => { console.error(`\n[talon] ${s}\n`); process.exit(1); };

// ---------- 1. Node version ----------
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 22 || (maj === 22 && min < 12)) {
  die(`Node ${process.versions.node} is too old. TALON needs Node 22.12 or newer (the Hyperliquid SDK requires it).\n        Download it from https://nodejs.org/ (LTS), install, then run this launcher again.`);
}

// ---------- helpers ----------
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: WIN, ...opts });
  if (r.error) die(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) die(`"${cmd} ${args.join(" ")}" exited with code ${r.status}`);
}
/** newest mtime under a directory (recursive, cheap: skips node_modules/dist/.next) */
function newest(dir) {
  let t = 0;
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist" || e.name === ".next" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { const m = statSync(p).mtimeMs; if (m > t) t = m; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return t;
}
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const stale = (out, ...srcDirs) => !existsSync(out) || Math.max(...srcDirs.map(newest)) > mtime(out);

async function probe(timeoutMs = 1500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { const r = await fetch(`${URL_}/api/system?lines=0`, { signal: ctl.signal }); return r.ok; } catch { return false; } finally { clearTimeout(t); }
}
function openBrowser(url) {
  try {
    if (WIN) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch { /* no browser available (server); the URL is printed anyway */ }
}

// ---------- 2. already running? ----------
if (await probe()) {
  log(`TALON is already running at ${URL_} — opening it.`);
  openBrowser(URL_);
  process.exit(0);
}

// ---------- 3. dependencies ----------
if (!existsSync(join(ROOT, "node_modules", "next")) || !existsSync(join(ROOT, "node_modules", "better-sqlite3"))) {
  log("installing dependencies (first run, takes a minute)…");
  run("npm", ["install"]);
}

// ---------- 4. builds (only when sources are newer than the output) ----------
const builds = [
  ["core", stale(join(ROOT, "core", "dist", "index.js"), join(ROOT, "core", "src"))],
  ["bot", stale(join(ROOT, "bot", "dist", "main.js"), join(ROOT, "bot", "src"), join(ROOT, "core", "src"))],
  ["web", stale(join(ROOT, "web", ".next", "BUILD_ID"), join(ROOT, "web", "app"), join(ROOT, "web", "components"), join(ROOT, "web", "lib"))],
];
// core must be rebuilt before bot/web when any of them is stale (they import the compiled package)
if (builds[1][1] || builds[2][1]) builds[0][1] = builds[0][1] || !existsSync(join(ROOT, "core", "dist", "index.js"));
for (const [ws, need] of builds) {
  if (!need) { log(`${ws}: build is up to date`); continue; }
  log(`building ${ws}…`);
  run("npm", ["run", "build", "-w", ws]);
}

// ---------- 5. data dir and .env ----------
mkdirSync(join(ROOT, "data", "logs"), { recursive: true });
const envFile = process.env.TALON_ENV_FILE ? resolve(ROOT, process.env.TALON_ENV_FILE) : join(ROOT, ".env");
if (!existsSync(envFile)) {
  if (existsSync(join(ROOT, ".env.example"))) { copyFileSync(join(ROOT, ".env.example"), envFile); log(`created ${envFile} from .env.example (paper mode)`); }
}

// ---------- 6. start the dashboard ----------
log(`starting dashboard on ${URL_} …`);
const nextBin = join(ROOT, "node_modules", "next", "dist", "bin", "next");
const HOST = process.env.TALON_HOST || "127.0.0.1"; // loopback only: the dashboard has no authentication
const web = spawn(process.execPath, [nextBin, "start", "-p", String(PORT), "-H", HOST], {
  cwd: join(ROOT, "web"), stdio: "inherit", windowsHide: true,
  env: { ...process.env, NODE_ENV: "production", NEXT_MANUAL_SIG_HANDLE: "1", DB_PATH: process.env.DB_PATH || join(ROOT, "data", "talon.db") },
});
let shuttingDown = false;
web.on("exit", (code, signal) => {
  if (shuttingDown) return;
  die(`dashboard exited (code ${code ?? "?"}${signal ? `, ${signal}` : ""}). If this is the first run, check the error above; "npm run build -w web" rebuilds the dashboard.`);
});

// wait until it answers, then open the browser
let up = false;
for (let i = 0; i < 120 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await probe(1000); }
if (up) {
  log(`dashboard ready → ${URL_}`);
  log("everything (data, backtests, strategy, paper/live bot) is controlled from the browser. Ctrl+C here stops the dashboard and the bot process.");
  openBrowser(URL_);
} else log(`dashboard did not answer within 60 s — open ${URL_} manually or check the output above.`);

// ---------- 7. shutdown ----------
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${sig}: asking the dashboard to stop the bot process (open position and exchange stops are kept)…`);
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20_000);
    const r = await fetch(`${URL_}/api/process`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }), signal: ctl.signal });
    clearTimeout(t);
    const b = await r.json().catch(() => ({}));
    log(`bot process: ${b?.process?.status ?? "unknown"}`);
  } catch (e) { log(`could not reach the dashboard to stop the bot (${e.message}); if a bot is still running, stop it from the dashboard next time`); }
  log("stopping dashboard…");
  try { web.kill(WIN ? undefined : "SIGTERM"); } catch { /* gone */ }
  setTimeout(() => { try { web.kill("SIGKILL"); } catch { /* gone */ } process.exit(0); }, 5000).unref();
  web.once("exit", () => process.exit(0));
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
if (WIN) process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
