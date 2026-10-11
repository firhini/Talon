/**
 * Next.js instrumentation hook (server start). With NEXT_MANUAL_SIG_HANDLE=1 (set by scripts/launch.mjs) Next leaves
 * SIGINT/SIGTERM to us, so a Ctrl+C in the terminal lets the supervisor stop the bot child cleanly before the web
 * server exits (the bot persists its state; positions and exchange stop orders stay as they are).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getSupervisor } = await import("./lib/supervisor");
  let closing = false;
  const bye = async (sig: string) => {
    if (closing) return;
    closing = true;
    try { await getSupervisor().stop(); } catch { /* nothing running */ }
    console.log(`[talon] ${sig}: bot stopped, web server exiting`);
    process.exit(0);
  };
  if (process.env.NEXT_MANUAL_SIG_HANDLE === "1") {
    process.on("SIGINT", () => void bye("SIGINT"));
    process.on("SIGTERM", () => void bye("SIGTERM"));
  }
}
