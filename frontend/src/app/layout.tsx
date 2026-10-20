import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Personal Blog", template: "%s | Personal Blog" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <header>
          <nav>
            <Link href="/">首頁</Link>
            <Link href="/posts/">文章</Link>
            <Link href="/search/">搜尋</Link>
            <Link href="/about/">關於</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
