import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { absoluteUrl } from "../site.ts";
import "./globals.css";
import { HeaderSearch } from "./header-search.tsx";

export const metadata: Metadata = {
  title: { default: "Personal Blog", template: "%s | Personal Blog" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        {/* Not metadata.alternates: every page sets its own alternates.canonical, which replaces the layout's. */}
        <link rel="alternate" type="application/rss+xml" title="Personal Blog" href={absoluteUrl("/feed.xml")} />
      </head>
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
        <footer>
          <span>© {new Date().getFullYear()} Hack-Ray</span>
          <a href="https://github.com/Hack-Ray">GitHub</a>
          <Link href="/feed.xml">RSS</Link>
        </footer>
      </body>
    </html>
  );
}
