import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { loadSiteContent } from "../content/load.ts";
import { absoluteUrl, BASE_PATH, DEFAULT_OG_IMAGE, siteOg } from "../site.ts";
import "./globals.css";
import { THEME_SCRIPT } from "../theme.ts";
import { HeaderSearch } from "./header-search.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function generateMetadata(): Metadata {
  const { title, description } = loadSiteContent().profile.site;
  const googleVerification = process.env.GOOGLE_SITE_VERIFICATION;
  return {
    title: { default: title, template: `%s | ${title}` },
    description: description || undefined,
    openGraph: { ...siteOg(title), images: [DEFAULT_OG_IMAGE] },
    twitter: { card: "summary", images: [DEFAULT_OG_IMAGE] },
    // Lets Google show large image previews, e.g. in Discover. Pages that set robots (noindex) replace this.
    robots: { "max-image-preview": "large" },
    // Edit frontend/public/icon.svg and run `npm run icons` to change them and og-default.png.
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
        <a className="skip-link" href="#main">
          跳到主要內容
        </a>
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
        <main id="main">{children}</main>
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
