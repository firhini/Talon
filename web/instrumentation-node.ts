/**
 * With NEXT_MANUAL_SIG_HANDLE=1 (set by scripts/launch.mjs) Next leaves SIGINT/SIGTERM to us, so a Ctrl+C lets the
 * supervisor stop the bot child cleanly before the web server exits (positions and exchange stop orders stay).
 */
export function registerSignalHandlers(): void {
  if (process.env.NEXT_MANUAL_SIG_HANDLE !== "1") return;
  let closing = false;
  const bye = async (sig: string) => {
    if (closing) return;
    closing = true;
    try {
      const { getSupervisor } = await import("./lib/supervisor");
      await getSupervisor().stop();
    } catch { /* nothing running */ }
    console.log(`[talon] ${sig}: bot stopped, web server exiting`);
    process.exit(0);
  };
  process.on("SIGINT", () => void bye("SIGINT"));
  process.on("SIGTERM", () => void bye("SIGTERM"));
  if (process.platform === "win32") process.on("SIGBREAK", () => void bye("SIGBREAK"));
}
