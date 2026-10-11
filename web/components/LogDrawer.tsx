"use client";
import { useEffect, useRef, useState } from "react";
import type { JobView } from "@/lib/supervisor";

type Source = { kind: "bot" } | { kind: "job"; id: number };

/** Collapsible log viewer (bot log or a job's log), tail of 200 lines, auto-scroll, polls every 5 s while open. */
export default function LogDrawer({ jobs, defaultOpen = false, title = "Logs", poll = true, fixed = true }: { jobs?: JobView[]; defaultOpen?: boolean; title?: string; poll?: boolean; fixed?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [src, setSrc] = useState<Source>({ kind: "bot" });
  const [lines, setLines] = useState<string[]>([]);
  const [meta, setMeta] = useState<string>("");
  const [follow, setFollow] = useState(true);
  const pre = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        if (src.kind === "bot") {
          const r = await fetch("/api/process?lines=200", { cache: "no-store" });
          const b = (await r.json()) as { log?: { lines: string[]; size: number }; process?: { logPath: string } };
          if (!stop) { setLines(b.log?.lines ?? []); setMeta(`${b.process?.logPath ?? "bot.log"} · ${((b.log?.size ?? 0) / 1024).toFixed(0)} KB`); }
        } else {
          const r = await fetch(`/api/jobs/${src.id}?tail=200`, { cache: "no-store" });
          const b = (await r.json()) as { job?: JobView };
          if (!stop && b.job) { setLines(b.job.logTail.split("\n")); setMeta(`job #${b.job.id} ${b.job.kind} · ${b.job.status}`); }
        }
      } catch { /* keep */ }
    };
    void load();
    const id = poll ? setInterval(load, 5000) : null;
    return () => { stop = true; if (id) clearInterval(id); };
  }, [open, src, poll]);

  useEffect(() => { if (follow && pre.current) pre.current.scrollTop = pre.current.scrollHeight; }, [lines, follow]);

  const wrap = fixed ? "fixed inset-x-0 bottom-0 z-30 mx-auto max-w-[1600px] px-4 sm:px-6" : "";
  return (
    <div className={wrap}>
      <section className={`panel overflow-hidden ${fixed ? "rounded-b-none border-b-0 shadow-[0_-10px_40px_rgba(0,0,0,.5)]" : ""}`}>
        <header className="flex items-center gap-3 px-3 py-1.5">
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "▾" : "▴"} {title}</button>
          {open && (
            <>
              <select className="input w-auto py-0.5 text-xs" value={src.kind === "bot" ? "bot" : String(src.id)} onChange={(e) => setSrc(e.target.value === "bot" ? { kind: "bot" } : { kind: "job", id: Number(e.target.value) })}>
                <option value="bot">bot.log</option>
                {(jobs ?? []).map((j) => <option key={j.id} value={j.id}>job #{j.id} {j.kind} ({j.status})</option>)}
              </select>
              <span className="truncate text-[11px] text-zinc-500">{meta}</span>
              <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> follow</label>
            </>
          )}
          {!open && <span className="text-[11px] text-zinc-600">bot log · job logs · tail -200</span>}
        </header>
        {open && (
          <div ref={pre} className="scroll-y max-h-72 overflow-y-auto border-t border-zinc-800 bg-black/40 px-3 py-2" onScroll={(e) => { const el = e.currentTarget; setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 8); }}>
            <pre className="log">{lines.length ? lines.join("\n") : "(empty)"}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
