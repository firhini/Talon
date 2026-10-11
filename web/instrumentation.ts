/**
 * Next.js instrumentation hook (server start). The Node-only signal handling lives in instrumentation-node.ts so the
 * Edge bundle never sees process.on (avoids build warnings).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerSignalHandlers } = await import("./instrumentation-node");
    registerSignalHandlers();
  }
}
