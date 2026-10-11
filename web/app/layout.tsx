import type { Metadata } from "next";
import Mascot from "@/components/Mascot";
import "./globals.css";

export const metadata: Metadata = { title: "TALON", description: "TALON — Hyperliquid perps trading agent dashboard" };

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
