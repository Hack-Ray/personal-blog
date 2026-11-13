import type { Metadata } from "next";
import { loadSiteContent } from "../../content/load.ts";
import { renderMarkdown } from "../../content/markdown.ts";
import { jsonLd, profilePage } from "../../content/structured-data.ts";
import { absoluteUrl, BASE_PATH } from "../../site.ts";
import { ArticleBody } from "../article-body.tsx";

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(profilePage({ name, links })) }} />
      <h1>{name}</h1>
      {headline && <p className="meta">{headline}</p>}
      {intro && <ArticleBody html={renderMarkdown(intro, BASE_PATH)} />}
      {/* Profile entries may repeat, and these lists never reorder, so positions are the keys. */}
      {links.length > 0 && (
        <ul className="links">
          {links.map((l, i) => (
            <li key={i}>
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
          <ul className="experience-list">
            {experience.map((e, i) => (
              <li key={i}>
                <div className="experience-head">
                  <span>
                    <strong>{e.role}</strong> · {e.organization}
                  </span>
                  <span className="meta experience-period">{e.period}</span>
                </div>
                {e.description && <p>{e.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {projects.length > 0 && (
        <section>
          <h2>作品</h2>
          <ul className="project-grid">
            {projects.map((p, i) => (
              <li key={i} className="project-card">
                <h3>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noopener">
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </h3>
                <p>{p.description}</p>
                {p.tags.length > 0 && <ProjectTags tags={p.tags} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const VISIBLE_TAGS = 8;

/** Long tag lists fold behind a "+N" toggle; <details> keeps it working without JavaScript. */
function ProjectTags({ tags }: { tags: string[] }) {
  const visible = tags.slice(0, VISIBLE_TAGS);
  const hidden = tags.slice(VISIBLE_TAGS);
  const chips = (list: string[]) => list.map((t, i) => <span key={i} className="tag-chip">{t}</span>);
  if (hidden.length === 0) return <div className="project-tags">{chips(visible)}</div>;
  return (
    <details className="project-tags-more">
      <summary className="project-tags">
        {chips(visible)}
        <span className="tag-chip tag-more">+{hidden.length}</span>
      </summary>
      <div className="project-tags">{chips(hidden)}</div>
    </details>
  );
}
