import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { loadSiteContent } from "../content/load.ts";
import { absoluteUrl, BASE_PATH, siteOg } from "../site.ts";
import "./globals.css";
import { THEME_SCRIPT } from "../theme.ts";
import { HeaderSearch } from "./header-search.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

// Replace frontend/public/og-default.png to change it.
const DEFAULT_IMAGE = absoluteUrl("/og-default.png");

export function generateMetadata(): Metadata {
  const { title, description } = loadSiteContent().profile.site;
  const googleVerification = process.env.GOOGLE_SITE_VERIFICATION;
  return {
    title: { default: title, template: `%s | ${title}` },
    description: description || undefined,
    // Article pages set their own openGraph and twitter, so the default image only reaches the other pages.
    openGraph: { ...siteOg(title), images: [DEFAULT_IMAGE] },
    twitter: { card: "summary", images: [DEFAULT_IMAGE] },
    // Edit frontend/public/icon.svg and run `npm run icons` to change them.
    icons: {
      icon: [
        { url: `${BASE_PATH}/favicon.ico`, sizes: "48x48" },
        { url: `${BASE_PATH}/icon.svg`, type: "image/svg+xml" },
      ],
      apple: { url: `${BASE_PATH}/apple-touch-icon.png`, sizes: "180x180" },
    },
    verification: googleVerification ? { google: googleVerification } : undefined,
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
            {links.map((l, i) => (
              <a key={i} href={l.url} rel="me noopener">
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
