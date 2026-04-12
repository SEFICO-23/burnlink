import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "burnlink",
  description: "FB Ads → private Telegram channel tracker",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-text font-sans">{children}</body>
    </html>
  );
}
