import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { HeaderSearch } from "./header-search.tsx";

export const metadata: Metadata = {
  title: { default: "Personal Blog", template: "%s | Personal Blog" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <header>
          <Link href="/" className="site-title">
            Personal Blog
          </Link>
          <nav>
            <Link href="/">首頁</Link>
            <Link href="/posts/">文章</Link>
            <HeaderSearch />
            <Link href="/about/">關於</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
