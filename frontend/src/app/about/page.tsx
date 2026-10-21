import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import { renderMarkdown } from "../../content/markdown.ts";
import { absoluteUrl, BASE_PATH } from "../../site.ts";

export function generateMetadata(): Metadata {
  return {
    title: "關於",
    description: loadSiteContent().profile.headline || undefined,
    alternates: { canonical: absoluteUrl("/about/") },
  };
}

export default function AboutPage() {
  const { name, headline, intro, links, experience, projects } = loadSiteContent().profile;
  return (
    <>
      <h1>{name}</h1>
      {headline && <p className="meta">{headline}</p>}
      {intro && <div className="article-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(intro, BASE_PATH) }} />}
      {links.length > 0 && (
        <ul className="links">
          {links.map((l) => (
            <li key={l.url}>
              <a href={l.url} rel="me noopener" target={l.url.startsWith("mailto:") ? undefined : "_blank"}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {experience.length > 0 && (
        <section>
          <h2>經歷</h2>
          <ul className="article-list">
            {experience.map((e) => (
              <li key={`${e.organization}-${e.period}`}>
                <strong>{e.role}</strong> · {e.organization}
                <p className="meta">{e.period}</p>
                {e.description && <p>{e.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {projects.length > 0 && (
        <section>
          <h2>作品</h2>
          <ul className="article-list">
            {projects.map((p) => (
              <li key={p.name}>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noopener">
                    {p.name}
                  </a>
                ) : (
                  <strong>{p.name}</strong>
                )}
                <p>{p.description}</p>
                {p.tags.length > 0 && <p className="meta">{p.tags.join(" · ")}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
