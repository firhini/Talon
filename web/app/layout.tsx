import type { Metadata } from "next";
import Mascot from "@/components/Mascot";
import "./globals.css";

const ICON = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#09090b"/><path d="M3 4h10v2H9v7H7V6H3z" fill="#f0b429"/></svg>');
export const metadata: Metadata = { title: "TALON", description: "TALON — Hyperliquid perps trading agent dashboard", icons: { icon: ICON } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        {children}
        <Mascot />
      </body>
    </html>
  );
}
