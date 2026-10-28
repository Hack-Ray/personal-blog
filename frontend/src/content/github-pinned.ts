import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PinnedRepo = { name: string; url: string; description: string | null; language: string | null; languageColor: string | null; stars: number };
export type GitHubPinned = { login: string; repos: PinnedRepo[] };

export const PINNED_REPOS_FILE = resolve(".generated/github-pinned.json");

const URL_PREFIX = "https://github.com/";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`pinned repository ${what} is not a string`);
  return value;
}

function colorOrNull(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

function parseNode(node: unknown, login: string): PinnedRepo {
  if (!isObject(node)) throw new Error("malformed pinned repository node");
  const { name, owner, url, stargazerCount, primaryLanguage } = node;
  if (typeof name !== "string" || name === "") throw new Error("pinned repository has no name");
  if (!isObject(owner) || typeof owner.login !== "string") throw new Error(`pinned repository ${name} has no owner`);
  if (typeof url !== "string" || !url.startsWith(URL_PREFIX)) throw new Error(`pinned repository ${name} has an unexpected url`);
  if (typeof stargazerCount !== "number" || !Number.isInteger(stargazerCount) || stargazerCount < 0) {
    throw new Error(`pinned repository ${name} has an invalid star count`);
  }
  if (primaryLanguage !== null && primaryLanguage !== undefined && !isObject(primaryLanguage)) {
    throw new Error(`pinned repository ${name} has an invalid language`);
  }
  return {
    name: owner.login.toLowerCase() === login.toLowerCase() ? name : `${owner.login}/${name}`,
    url,
    description: nullableString(node.description, "description"),
    language: primaryLanguage ? nullableString(primaryLanguage.name, "language") : null,
    languageColor: primaryLanguage ? colorOrNull(primaryLanguage.color) : null,
    stars: stargazerCount,
  };
}

export function parsePinnedResponse(json: unknown, login: string): PinnedRepo[] {
  if (!isObject(json)) throw new Error("response is not an object");
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const messages = json.errors.map((e) => (isObject(e) && typeof e.message === "string" ? e.message : "unknown error"));
    throw new Error(`GraphQL errors: ${messages.join("; ")}`);
  }
  const data = json.data;
  if (!isObject(data) || !isObject(data.user)) throw new Error(`GitHub user "${login}" not found`);
  const pinnedItems = data.user.pinnedItems;
  if (!isObject(pinnedItems) || !Array.isArray(pinnedItems.nodes)) throw new Error("response has no pinned items");
  return pinnedItems.nodes.map((node) => parseNode(node, login));
}

export function readGitHubPinned(): GitHubPinned | null {
  if (!existsSync(PINNED_REPOS_FILE)) return null;
  const pinned: GitHubPinned = JSON.parse(readFileSync(PINNED_REPOS_FILE, "utf8"));
  return pinned.repos.length > 0 ? pinned : null;
}
