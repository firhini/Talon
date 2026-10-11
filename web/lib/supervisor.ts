import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, statSync, truncateSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createJob as dbCreateJob, getControl, getJob, listJobs, logEvent, PRESETS, REPO_ROOT, runningJobs, setControl, setSettings, updateJob,
  type DB, type JobKind, type JobRow, type PresetId,
} from "@talon/core";
import { dbPath, getDb } from "./db";
import { composeEnv, liveChecklist, isPresetId } from "./effective";

/**
 * Server-side process supervisor: runs the bot as a child process and executes dashboard jobs (data fetch,
 * backtests, sweeps, scans) one at a time. Lives on globalThis so Next route reloads keep the same instance.
 */

export type ProcStatus = "stopped" | "running" | "stopping" | "crashed";
export type DashMode = "paper" | "live";
export interface LastExit { code: number | null; signal: string | null; at: number; requested: boolean }
export interface ProcessView {
  status: ProcStatus; pid: number | null; startedAt: number | null; uptimeMs: number | null; mode: DashMode | null; preset: string | null;
  restarts: number; lastExit: LastExit | null; external: boolean; logPath: string; liveConfirmed: boolean; built: boolean;
}
export interface JobView {
  id: number; kind: JobKind; status: JobRow["status"]; args: Record<string, unknown>; createdAt: number; startedAt: number | null; finishedAt: number | null;
  durationMs: number | null; result: unknown; pid: number | null; logTail: string;
}
export class SupervisorError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "SupervisorError"; }
}

const LOG_MAX = 5 * 1024 * 1024;
const STOP_GRACE_MS = 60_000; // > the bot poll interval: a tick in flight (entry fill → stop placement) must never be SIGKILLed
const JOB_GRACE_MS = 5_000;
const TOKEN_TTL_MS = 120_000;

interface BotRun {
  child: ChildProcess | null; pid: number | null; status: ProcStatus; startedAt: number | null; mode: DashMode | null; preset: string | null;
  restarts: number; lastExit: LastExit | null; external: boolean; stopRequested: boolean; killTimer: NodeJS.Timeout | null; liveConfirmed: boolean;
  waiters: (() => void)[];
}
interface JobRun { id: number; child: ChildProcess; buf: string; flush: NodeJS.Timeout | null; cancelRequested: boolean; killTimer: NodeJS.Timeout | null; backtestIds: number[]; mode: DashMode }

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

export class Supervisor {
  private readonly bot: BotRun = { child: null, pid: null, status: "stopped", startedAt: null, mode: null, preset: null, restarts: 0, lastExit: null, external: false, stopRequested: false, killTimer: null, liveConfirmed: false, waiters: [] };
  private jobRun: JobRun | null = null;
  private readonly tokens = new Map<string, number>();
  readonly logPath: string;
  readonly startedAt = Date.now();

  constructor(private readonly db: DB) {
    this.logPath = resolve(dirname(dbPath()), "logs", "bot.log");
    mkdirSync(dirname(this.logPath), { recursive: true });
    this.recover();
    const t = setInterval(() => this.housekeeping(), 5_000);
    t.unref();
    setTimeout(() => this.kick(), 0);
  }

  // ------------------------------------------------------------------ bot process
  private recover(): void {
    const pid = Number(getControl(this.db, "proc:bot:pid") ?? 0);
    const status = getControl(this.db, "proc:bot:status");
    this.bot.restarts = Number(getControl(this.db, "proc:bot:restarts") ?? 0) || 0;
    const le = getControl(this.db, "proc:bot:last_exit");
    if (le) { try { this.bot.lastExit = JSON.parse(le) as LastExit; } catch { /* ignore */ } }
    if (pid > 0 && (status === "running" || status === "stopping") && alive(pid)) {
      // a bot started by a previous web server instance is still alive: track it by pid
      this.bot.pid = pid; this.bot.status = "running"; this.bot.external = true;
      this.bot.startedAt = Number(getControl(this.db, "proc:bot:started_at") ?? Date.now());
      this.bot.mode = (getControl(this.db, "proc:bot:mode") as DashMode | null) ?? null;
      this.bot.preset = getControl(this.db, "proc:bot:preset");
    } else if (status === "running" || status === "stopping") {
      this.bot.status = "stopped";
      this.bot.lastExit = { code: null, signal: null, at: Date.now(), requested: false };
      this.persistBot();
    }
    // jobs left behind by a previous web server: running ones are orphaned (their output is lost) → failed; queued ones resume
    for (const j of runningJobs(this.db)) {
      if (j.status !== "running") continue;
      if (j.pid && alive(j.pid)) { try { process.kill(j.pid, "SIGTERM"); } catch { /* gone */ } }
      updateJob(this.db, j.id, { status: "failed", finishedAt: Date.now(), appendLog: "\n[supervisor] job orphaned by a web server restart\n" });
    }
  }

  private persistBot(): void {
    const b = this.bot;
    setControl(this.db, "proc:bot:pid", String(b.pid ?? ""));
    setControl(this.db, "proc:bot:status", b.status);
    setControl(this.db, "proc:bot:started_at", String(b.startedAt ?? ""));
    setControl(this.db, "proc:bot:mode", b.mode ?? "");
    setControl(this.db, "proc:bot:preset", b.preset ?? "");
    setControl(this.db, "proc:bot:restarts", String(b.restarts));
    setControl(this.db, "proc:bot:last_exit", b.lastExit ? JSON.stringify(b.lastExit) : "");
  }

  private housekeeping(): void {
    const b = this.bot;
    if (b.external && b.pid && b.status !== "stopped" && !alive(b.pid)) {
      b.status = b.stopRequested ? "stopped" : "crashed"; b.pid = null; b.external = false;
      b.lastExit = { code: null, signal: null, at: Date.now(), requested: b.stopRequested };
      this.persistBot(); this.wake();
    }
    this.rotateLog(true);
  }

  private rotateLog(copyTruncate: boolean): void {
    try {
      if (!existsSync(this.logPath) || statSync(this.logPath).size < LOG_MAX) return;
      copyFileSync(this.logPath, this.logPath + ".1");
      if (copyTruncate) truncateSync(this.logPath, 0); // the child's O_APPEND fd keeps writing at the new end
    } catch { /* best effort */ }
  }

  botBuilt(): boolean { return existsSync(resolve(REPO_ROOT, "bot", "dist", "main.js")); }

  process(): ProcessView {
    const b = this.bot;
    return {
      status: b.status, pid: b.pid, startedAt: b.startedAt, uptimeMs: b.status === "running" && b.startedAt ? Date.now() - b.startedAt : null, mode: b.mode, preset: b.preset,
      restarts: b.restarts, lastExit: b.lastExit, external: b.external, logPath: this.logPath, liveConfirmed: b.liveConfirmed, built: this.botBuilt(),
    };
  }

  async start(opts: { mode: DashMode; token?: string; restart?: boolean }): Promise<ProcessView> {
    const b = this.bot;
    if (b.status === "running" || b.status === "stopping") throw new SupervisorError(`bot process is already ${b.status} (pid ${b.pid})`, 409);
    if (!this.botBuilt()) throw new SupervisorError("bot is not built (bot/dist/main.js missing) — run the launcher (talon.sh / talon.bat) once", 500);
    if (opts.mode === "live") {
      if (!opts.token || !this.consumeToken(opts.token)) throw new SupervisorError("live start requires a fresh confirmation token (type LIVE in the Go-live dialog)", 403);
      const check = liveChecklist(this.db);
      if (!check.ready) throw new SupervisorError(`live start refused: ${check.problems.join("; ")}`, 400);
    }
    const env = composeEnv(this.db, { mode: opts.mode, liveConfirmed: opts.mode === "live" });
    this.rotateLog(false);
    const fd = openSync(this.logPath, "a");
    writeSync(fd, `\n===== ${new Date().toISOString()} supervisor: starting bot (${opts.mode}${env.STRATEGY_PRESET ? `, preset ${env.STRATEGY_PRESET}` : ""}) =====\n`);
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [resolve(REPO_ROOT, "bot", "dist", "main.js")], { cwd: REPO_ROOT, env, stdio: ["ignore", fd, fd], windowsHide: true });
    } finally { closeSync(fd); }
    b.child = child; b.pid = child.pid ?? null; b.status = "running"; b.startedAt = Date.now(); b.mode = opts.mode; b.preset = env.STRATEGY_PRESET || null;
    b.external = false; b.stopRequested = false; b.liveConfirmed = opts.mode === "live"; b.lastExit = null;
    if (opts.restart) b.restarts += 1;
    child.on("error", (err) => { this.onExit(null, null, err.message); });
    child.on("exit", (code, signal) => { this.onExit(code, signal); });
    this.persistBot();
    logEvent(this.db, opts.mode, "info", `dashboard: bot process ${opts.restart ? "restarted" : "started"} (pid ${b.pid}${b.preset ? `, preset ${b.preset}` : ""})`);
    return this.process();
  }

  private onExit(code: number | null, signal: NodeJS.Signals | null, error?: string): void {
    const b = this.bot;
    if (b.child === null && !b.external) return;
    const requested = b.stopRequested;
    b.lastExit = { code, signal, at: Date.now(), requested };
    b.status = requested || code === 0 ? "stopped" : "crashed";
    b.child = null; b.pid = null; b.external = false;
    if (b.killTimer) { clearTimeout(b.killTimer); b.killTimer = null; }
    this.persistBot();
    try {
      const fd = openSync(this.logPath, "a");
      writeSync(fd, `===== ${new Date().toISOString()} supervisor: bot exited (code ${code}, signal ${signal ?? "-"}${error ? `, error ${error}` : ""}${requested ? ", requested" : ""}) =====\n`);
      closeSync(fd);
    } catch { /* ignore */ }
    if (b.mode) logEvent(this.db, b.mode, requested ? "info" : "error", `bot process ${requested ? "stopped" : `exited unexpectedly (code ${code ?? "?"}${signal ? `, ${signal}` : ""}${error ? `: ${error}` : ""})`}`);
    this.wake();
  }
  private wake(): void { const w = this.bot.waiters.splice(0); for (const f of w) f(); }

  /** SIGTERM, then SIGKILL after the grace period. Resolves once the process is gone. The bot keeps positions and exchange stops. */
  async stop(): Promise<ProcessView> {
    const b = this.bot;
    if (b.status !== "running" && b.status !== "stopping") return this.process();
    if (!b.pid) return this.process();
    b.stopRequested = true; b.status = "stopping"; this.persistBot();
    try { if (b.child) b.child.kill("SIGTERM"); else process.kill(b.pid, "SIGTERM"); } catch { /* already gone */ }
    const pid = b.pid;
    b.killTimer = setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }, STOP_GRACE_MS);
    b.killTimer.unref();
    await new Promise<void>((res) => {
      const done = () => { clearTimeout(t); res(); };
      b.waiters.push(done);
      const t = setTimeout(done, STOP_GRACE_MS + 3_000);
    });
    if (b.external && b.pid && !alive(b.pid)) { b.status = "stopped"; b.pid = null; b.external = false; b.lastExit = { code: null, signal: "SIGTERM", at: Date.now(), requested: true }; this.persistBot(); }
    return this.process();
  }

  async restart(opts: { token?: string } = {}): Promise<ProcessView> {
    const mode = this.bot.mode ?? "paper";
    if (mode === "live" && !(opts.token && this.peekToken(opts.token))) throw new SupervisorError("restarting a LIVE bot needs a fresh confirmation (type LIVE)", 403);
    await this.stop();
    return this.start({ mode, token: opts.token, restart: true });
  }

  /** Last `lines` lines of the bot log (reads only the tail of the file). */
  logTail(lines = 200): { lines: string[]; size: number } {
    try {
      if (!existsSync(this.logPath)) return { lines: [], size: 0 };
      const size = statSync(this.logPath).size;
      const want = Math.min(size, Math.max(64 * 1024, lines * 400));
      const fd = openSync(this.logPath, "r");
      const buf = Buffer.alloc(want);
      readSync(fd, buf, 0, want, size - want);
      closeSync(fd);
      const all = buf.toString("utf8").split(/\r?\n/);
      if (all.length && all[all.length - 1] === "") all.pop();
      return { lines: all.slice(-lines), size };
    } catch { return { lines: [], size: 0 }; }
  }

  // ------------------------------------------------------------------ live confirmation tokens
  mintToken(): { token: string; expiresAt: number } {
    const now = Date.now();
    for (const [k, exp] of this.tokens) if (exp < now) this.tokens.delete(k);
    const token = randomBytes(24).toString("hex");
    const expiresAt = now + TOKEN_TTL_MS;
    this.tokens.set(token, expiresAt);
    return { token, expiresAt };
  }
  private peekToken(token: string): boolean { const exp = this.tokens.get(token); return exp !== undefined && exp >= Date.now(); }
  private consumeToken(token: string): boolean { const ok = this.peekToken(token); this.tokens.delete(token); return ok; }

  // ------------------------------------------------------------------ jobs
  createJob(kind: JobKind, args: Record<string, unknown>): number {
    const id = dbCreateJob(this.db, kind, args);
    setTimeout(() => this.kick(), 0);
    return id;
  }

  jobs(limit = 50): JobView[] { return listJobs(this.db, limit).map((j) => this.jobView(j)); }
  job(id: number, tail = 0): JobView | null { const j = getJob(this.db, id); return j ? this.jobView(j, tail) : null; }
  current(): number | null { return this.jobRun?.id ?? null; }
  private jobView(j: JobRow, tail = 0): JobView {
    const end = j.finishedAt ?? (j.status === "running" ? Date.now() : null);
    const log = tail > 0 ? j.log.split("\n").slice(-tail).join("\n") : j.log;
    return { id: j.id, kind: j.kind, status: j.status, args: j.args, createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt, durationMs: j.startedAt && end ? end - j.startedAt : null, result: j.result, pid: j.pid, logTail: log };
  }

  cancel(id: number): JobView | null {
    const j = getJob(this.db, id);
    if (!j) return null;
    if (this.jobRun && this.jobRun.id === id) {
      this.jobRun.cancelRequested = true;
      try { this.jobRun.child.kill("SIGTERM"); } catch { /* gone */ }
      const child = this.jobRun.child;
      this.jobRun.killTimer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } }, JOB_GRACE_MS);
      this.jobRun.killTimer.unref();
    } else if (j.status === "queued") updateJob(this.db, id, { status: "cancelled", finishedAt: Date.now(), appendLog: "[supervisor] cancelled before start\n" });
    const after = getJob(this.db, id);
    return after ? this.jobView(after) : null;
  }

  private kick(): void {
    if (this.jobRun) return;
    const next = runningJobs(this.db).find((j) => j.status === "queued");
    if (next) this.runJob(next);
  }

  private runJob(j: JobRow): void {
    const a = j.args as Record<string, string | undefined>;
    const bin = (name: string) => resolve(REPO_ROOT, "bot", "dist", "cli", `${name}.js`);
    const argv: string[] = [];
    let env: NodeJS.ProcessEnv;
    const preset = isPresetId(a.preset) ? a.preset : undefined;
    const extra = a.env && typeof a.env === "object" ? (a.env as unknown as Record<string, string>) : undefined;
    try {
      switch (j.kind) {
        case "fetch":
          argv.push(bin("fetch-data"));
          if (a.from) argv.push("--from", a.from);
          if (a.to) argv.push("--to", a.to);
          if (a.intervals) argv.push("--intervals", a.intervals);
          if (a.coins) argv.push("--coins", a.coins);
          env = composeEnv(this.db, { mode: "paper" });
          break;
        case "backtest":
          argv.push(bin("backtest"), "--label", a.label || `${preset ?? "custom"} ${new Date().toISOString().slice(0, 16)}`);
          if (preset) argv.push("--preset", preset);
          if (a.from) argv.push("--from", a.from);
          if (a.to) argv.push("--to", a.to);
          if (a.kill) argv.push("--kill", a.kill);
          if (a.interval) argv.push("--interval", a.interval);
          if (a.breakdown) argv.push("--breakdown");
          env = composeEnv(this.db, { mode: "backtest", preset, extra });
          break;
        case "sweep":
          argv.push(bin("backtest"), "--sweep", "--save");
          if (preset) argv.push("--preset", preset);
          if (a.validateFrom) argv.push("--validate-from", a.validateFrom);
          if (a.grid) argv.push("--grid", a.grid);
          if (a.strategy) argv.push("--strategy", a.strategy);
          if (a.interval) argv.push("--interval", a.interval);
          if (a.only) argv.push("--only", a.only);
          env = composeEnv(this.db, { mode: "backtest", preset, extra });
          break;
        case "scan":
          argv.push(bin("scan"));
          env = composeEnv(this.db, { mode: "paper" });
          break;
        default:
          throw new Error(`unknown job kind ${String(j.kind)}`);
      }
      if (!existsSync(argv[0])) throw new Error(`${argv[0]} is missing — build the bot first (launcher does this)`);
    } catch (e) {
      updateJob(this.db, j.id, { status: "failed", startedAt: Date.now(), finishedAt: Date.now(), appendLog: `[supervisor] ${(e as Error).message}\n` });
      setTimeout(() => this.kick(), 0);
      return;
    }
    const child = spawn(process.execPath, argv, { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const run: JobRun = { id: j.id, child, buf: `[supervisor] node ${argv.map((s) => s.replace(REPO_ROOT, ".")).join(" ")}\n`, flush: null, cancelRequested: false, killTimer: null, backtestIds: [], mode: "paper" };
    this.jobRun = run;
    updateJob(this.db, j.id, { status: "running", startedAt: Date.now(), pid: child.pid ?? null });
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      run.buf += s;
      for (const m of s.matchAll(/saved backtest #(\d+)/g)) run.backtestIds.push(Number(m[1]));
      if (!run.flush) run.flush = setTimeout(() => this.flushJob(run), 400);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => { run.buf += `[supervisor] spawn error: ${err.message}\n`; });
    child.on("exit", (code, signal) => {
      this.flushJob(run);
      if (run.killTimer) clearTimeout(run.killTimer);
      const status: JobRow["status"] = run.cancelRequested ? "cancelled" : code === 0 ? "done" : "failed";
      const result = run.backtestIds.length ? { backtestId: run.backtestIds[run.backtestIds.length - 1], backtestIds: run.backtestIds, exitCode: code } : { exitCode: code, signal };
      updateJob(this.db, j.id, { status, finishedAt: Date.now(), result, appendLog: `[supervisor] ${status} (exit ${code ?? "?"}${signal ? `, ${signal}` : ""})\n` });
      this.jobRun = null;
      setTimeout(() => this.kick(), 0);
    });
  }
  private flushJob(run: JobRun): void {
    if (run.flush) { clearTimeout(run.flush); run.flush = null; }
    if (!run.buf) return;
    const s = run.buf; run.buf = "";
    try { updateJob(this.db, run.id, { appendLog: s }); } catch { /* db busy; the chunk is lost but the job continues */ }
  }

  // ------------------------------------------------------------------ preset activation
  /** Write the preset env into settings and restart a running paper bot. A live bot is stopped instead (go live again to apply). */
  async activatePreset(id: PresetId): Promise<{ restarted: boolean; stopped: boolean }> {
    const p = PRESETS[id];
    setSettings(this.db, { STRATEGY_PRESET: id, ...p.env });
    const b = this.bot;
    if (b.status !== "running") return { restarted: false, stopped: false };
    if (b.mode === "live") { await this.stop(); return { restarted: false, stopped: true }; }
    await this.restart();
    return { restarted: true, stopped: false };
  }
}

const g = globalThis as unknown as { __talonSupervisor?: Supervisor };
export function getSupervisor(): Supervisor {
  if (!g.__talonSupervisor) g.__talonSupervisor = new Supervisor(getDb());
  return g.__talonSupervisor;
}

/** Validate a job request from the API: kind + args whitelist with simple shapes. Returns an error string or null. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
export function validateJob(kind: unknown, args: unknown): { kind: JobKind; args: Record<string, unknown> } | { error: string } {
  if (kind !== "fetch" && kind !== "backtest" && kind !== "sweep" && kind !== "scan") return { error: "kind must be fetch|backtest|sweep|scan" };
  const a = (args && typeof args === "object" && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const str = (k: string, re?: RegExp, max = 120) => {
    const v = a[k];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || v.length > max || (re && !re.test(v))) return `${k} is invalid`;
    out[k] = v; return null;
  };
  const checks: (string | null)[] = [];
  if (kind === "fetch") checks.push(str("from", DATE_RE), str("to", DATE_RE), str("intervals", /^(15m|1h|4h)(,(15m|1h|4h))*$/), str("coins", /^[A-Za-z0-9,]+$/));
  if (kind === "backtest") checks.push(str("label", /^[^\n\r-][^\n\r]{0,79}$/), str("from", DATE_RE), str("to", DATE_RE), str("kill", /^(halt|off)$/), str("interval", /^(15m|1h|4h)$/), str("preset", /^[a-z0-9_-]+$/));
  if (kind === "sweep") checks.push(str("validateFrom", DATE_RE), str("grid", /^[A-Za-z0-9=,.;\s-]+$/, 300), str("strategy", /^(donchian|reclaim|apex)$/), str("interval", /^(15m|1h|4h)$/), str("only", /^[^-][A-Za-z0-9_.-]+$/), str("preset", /^[a-z0-9_-]+$/));
  const bad = checks.find((c) => c !== null);
  if (bad) return { error: bad };
  if (typeof out.preset === "string" && !isPresetId(out.preset)) return { error: `unknown preset ${out.preset}` };
  if (a.env !== undefined) {
    if (!a.env || typeof a.env !== "object" || Array.isArray(a.env)) return { error: "env must be an object" };
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(a.env as Record<string, unknown>)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(k) || ["HL_PRIVATE_KEY", "LIVE_CONFIRM", "DB_PATH", "MODE"].includes(k)) return { error: `env key ${k} not allowed` };
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return { error: `env ${k} must be a scalar` };
      const s = String(v);
      if (s.length > 200 || /[\r\n]/.test(s)) return { error: `env ${k} value invalid` };
      env[k] = s;
    }
    out.env = env;
  }
  if (a.breakdown === true) out.breakdown = true;
  return { kind, args: out };
}
