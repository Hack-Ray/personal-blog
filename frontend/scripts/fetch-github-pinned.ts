import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PINNED_REPOS_FILE, parsePinnedResponse, type GitHubPinned } from "../src/content/github-pinned.ts";

const QUERY = `query($login: String!) { user(login: $login) { pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { name owner { login } url description stargazerCount primaryLanguage { name } } } } } }`;

rmSync(PINNED_REPOS_FILE, { force: true });

const login = process.env.GITHUB_PINNED_USER?.trim();
if (login) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) throw new Error(`GITHUB_PINNED_USER is not a valid GitHub login: ${login}`);
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("::warning::GitHub pinned repositories: GITHUB_TOKEN is not set");
  } else {
    // A GitHub API hiccup must not block a content release; the section is just omitted.
    try {
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "personal-blog-build" },
        body: JSON.stringify({ query: QUERY, variables: { login } }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const repos = parsePinnedResponse(await response.json(), login);
      const pinned: GitHubPinned = { login, repos };
      mkdirSync(dirname(PINNED_REPOS_FILE), { recursive: true });
      writeFileSync(PINNED_REPOS_FILE, JSON.stringify(pinned));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`::warning::GitHub pinned repositories: ${reason.replaceAll("\n", " ")}`);
    }
  }
}
