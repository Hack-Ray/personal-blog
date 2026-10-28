import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePinnedResponse } from "./github-pinned.ts";

function node(overrides: Record<string, unknown> = {}) {
  return {
    name: "hello",
    owner: { login: "octocat" },
    url: "https://github.com/octocat/hello",
    description: "A repo",
    stargazerCount: 3,
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    ...overrides,
  };
}

const response = (...nodes: unknown[]) => ({ data: { user: { pinnedItems: { nodes } } } });

test("pinned repos: own repos use the bare name", () => {
  assert.deepEqual(parsePinnedResponse(response(node()), "octocat"), [
    { name: "hello", url: "https://github.com/octocat/hello", description: "A repo", language: "TypeScript", languageColor: "#3178c6", stars: 3 },
  ]);
});

test("pinned repos: owner login is compared case-insensitively", () => {
  assert.equal(parsePinnedResponse(response(node()), "OctoCat")[0].name, "hello");
});

test("pinned repos: foreign repos get an owner prefix", () => {
  const repos = parsePinnedResponse(response(node({ owner: { login: "someorg" }, url: "https://github.com/someorg/hello" })), "octocat");
  assert.equal(repos[0].name, "someorg/hello");
});

test("pinned repos: missing description and language stay null", () => {
  const [repo] = parsePinnedResponse(response(node({ description: null, primaryLanguage: null })), "octocat");
  assert.equal(repo.description, null);
  assert.equal(repo.language, null);
  assert.equal(repo.languageColor, null);
});

test("pinned repos: only #rrggbb language colors are kept", () => {
  const color = (value: unknown) => parsePinnedResponse(response(node({ primaryLanguage: { name: "Go", color: value } })), "octocat")[0].languageColor;
  assert.equal(color("#00ADD8"), "#00ADD8");
  assert.equal(color("red"), null);
  assert.equal(color("#fff"), null);
  assert.equal(color("#00ADD8; background: url(x)"), null);
  assert.equal(color(null), null);
  assert.equal(color(123), null);
});

test("pinned repos: no pinned items is an empty list", () => {
  assert.deepEqual(parsePinnedResponse(response(), "octocat"), []);
});

test("pinned repos: GraphQL errors throw with their message", () => {
  assert.throws(() => parsePinnedResponse({ errors: [{ message: "Bad credentials" }] }, "octocat"), /Bad credentials/);
});

test("pinned repos: unknown user throws", () => {
  assert.throws(() => parsePinnedResponse({ data: { user: null } }, "octocat"), /octocat/);
});

test("pinned repos: non-github urls are rejected", () => {
  assert.throws(() => parsePinnedResponse(response(node({ url: "https://evil.example/octocat/hello" })), "octocat"), /url/);
  assert.throws(() => parsePinnedResponse(response(node({ url: "javascript:alert(1)" })), "octocat"), /url/);
});

test("pinned repos: malformed nodes throw", () => {
  assert.throws(() => parsePinnedResponse(response(null), "octocat"));
  assert.throws(() => parsePinnedResponse(response(node({ stargazerCount: "3" })), "octocat"));
  assert.throws(() => parsePinnedResponse("nope", "octocat"));
});
