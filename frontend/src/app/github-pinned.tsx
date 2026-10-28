import { readGitHubPinned } from "../content/github-pinned.ts";

function GitHubMark() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
    </svg>
  );
}

export function GitHubPinned() {
  const pinned = readGitHubPinned();
  if (!pinned) return null;
  return (
    <aside className="github-pinned" aria-labelledby="github-pinned-title">
      <h2 id="github-pinned-title">
        <GitHubMark />
        GitHub 專案
      </h2>
      <ul>
        {pinned.repos.map((repo) => (
          <li key={repo.url}>
            <a className="repo-card" href={repo.url} rel="noopener">
              <span className="repo-name">
                <RepoIcon />
                {repo.name}
              </span>
              {repo.description && <span className="repo-desc">{repo.description}</span>}
              <span className="repo-meta">
                {repo.language && (
                  <span className="repo-language">
                    {repo.languageColor && <span className="language-dot" style={{ backgroundColor: repo.languageColor }} />}
                    {repo.language}
                  </span>
                )}
                <span className="repo-stars">
                  <StarIcon />
                  {repo.stars}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <a className="github-more" href={`https://github.com/${pinned.login}`} rel="noopener">
        更多 GitHub 專案 →
      </a>
    </aside>
  );
}
