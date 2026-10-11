import type { Mode } from "@talon/core";

export type DashMode = Extract<Mode, "paper" | "live">;

export function defaultMode(): DashMode {
  return process.env.MODE?.toLowerCase() === "live" ? "live" : "paper";
}

export function isDashMode(x: unknown): x is DashMode {
  return x === "paper" || x === "live";
}

/** ?mode=paper|live, falling back to MODE env (default paper). */
export function parseMode(raw: string | string[] | null | undefined): DashMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isDashMode(v) ? v : defaultMode();
}
