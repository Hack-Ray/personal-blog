import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { loadSiteContent } from "../content/load.ts";
import { absoluteUrl, BASE_PATH, siteOg } from "../site.ts";
import "./globals.css";
import { THEME_SCRIPT } from "../theme.ts";
import { HeaderSearch } from "./header-search.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function generateMetadata(): Metadata {
  const { title, description } = loadSiteContent().profile.site;
  return {
    title: { default: title, template: `%s | ${title}` },
    description: description || undefined,
    openGraph: siteOg(title),
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const { name, links, site } = loadSiteContent().profile;
  const { title } = site;
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Not metadata.alternates: every page sets its own alternates.canonical, which replaces the layout's. */}
        <link rel="alternate" type="application/rss+xml" title={title} href={absoluteUrl("/feed.xml")} />
      </head>
      <body>
        <header>
          <Link href="/" className="site-title">
            {title}
          </Link>
          <nav>
            <Link href="/">首頁</Link>
            <Link href="/posts/">文章</Link>
            <Link href="/topics/">分類</Link>
            <HeaderSearch />
            <Link href="/about/">關於</Link>
            <ThemeToggle />
          </nav>
        </header>
        <main>{children}</main>
        <footer>
          <p>
            <span>{site.footer || `© ${new Date().getFullYear()} ${name}`}</span>
            {links.map((l) => (
              <a key={l.url} href={l.url} rel="me noopener">
                {l.label}
              </a>
            ))}
            <a href={`${BASE_PATH}/feed.xml`}>RSS</a>
          </p>
        </footer>
      </body>
    </html>
  );
}
