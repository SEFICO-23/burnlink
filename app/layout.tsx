import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "burnlink",
  description: "FB Ads → private Telegram channel tracker",
};

const themeScript = `
  (function() {
    var t = localStorage.getItem('theme');
    if (t === 'light') return;
    document.documentElement.classList.add('dark');
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-bg text-text font-sans">{children}</body>
    </html>
  );
}
