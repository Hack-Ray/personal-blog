import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { absoluteUrl, BASE_PATH, SITE_OG } from "../site.ts";
import "./globals.css";
import { THEME_SCRIPT } from "../theme.ts";
import { HeaderSearch } from "./header-search.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export const metadata: Metadata = {
  title: { default: "Personal Blog", template: "%s | Personal Blog" },
  openGraph: SITE_OG,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
            <ThemeToggle />
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <p>
            <span>© {new Date().getFullYear()} Hack-Ray</span>
            <a href="https://github.com/Hack-Ray">GitHub</a>
            <a href={`${BASE_PATH}/feed.xml`}>RSS</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
