import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <div className="text-2xl font-black tracking-[0.3em] text-zinc-100">TALON</div>
      <p className="mt-4 text-zinc-400">Not found.</p>
      <Link href="/" className="mt-4 inline-block text-amber-300 hover:underline">Back to dashboard</Link>
    </div>
  );
}
