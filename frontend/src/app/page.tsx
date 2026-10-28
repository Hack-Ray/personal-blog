import type { Metadata } from "next";
import Link from "next/link";
import { readGitHubPinned } from "../content/github-pinned.ts";
import { loadSiteContent } from "../content/load.ts";
import { pinned, published } from "../content/queries.ts";
import { jsonLd, webSite } from "../content/structured-data.ts";
import { absoluteUrl } from "../site.ts";
import { ArticleList } from "./article-list.tsx";

export const metadata: Metadata = { alternates: { canonical: absoluteUrl("/") } };

const LATEST = 5;

function GitHubPinned() {
  const pinned = readGitHubPinned();
  if (!pinned) return null;
  return (
    <aside className="github-pinned" aria-labelledby="github-pinned-title">
      <h2 id="github-pinned-title">GitHub 專案</h2>
      <ul>
        {pinned.repos.map((repo) => (
          <li key={repo.url}>
            <a href={repo.url} rel="noopener">
              {repo.name}
            </a>
            {repo.description && <p>{repo.description}</p>}
            <p className="meta">{[repo.language, `★ ${repo.stars}`].filter(Boolean).join(" · ")}</p>
          </li>
        ))}
      </ul>
      <a href={`https://github.com/${pinned.login}`} rel="noopener">
        更多 GitHub 專案
      </a>
    </aside>
  );
}

export default function HomePage() {
  const content = loadSiteContent();
  const top = pinned(content);
  const latest = published(content)
    .filter((a) => !a.pinnedAt)
    .slice(0, LATEST);
  return (
    <div className="home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(webSite(content.profile.site)) }} />
      <h1>最新文章</h1>
      <ArticleList articles={[...top, ...latest]} showPinned />
      <p>
        <Link href="/posts/">所有文章</Link>
      </p>
      <GitHubPinned />
    </div>
  );
}
