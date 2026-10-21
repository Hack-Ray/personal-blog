import assert from "node:assert/strict";
import { test } from "node:test";
import type { Profile } from "./api.ts";
import { EMPTY_ROW, describeError, fromForm, move, parseTagList, sameForm, toForm, validate } from "./profile-form.ts";

const profile: Profile = {
  name: "Hack-Ray",
  headline: "Backend",
  intro: "I write **Python**.",
  links: [{ label: "GitHub", url: "https://github.com/Hack-Ray" }],
  experience: [{ role: "Engineer", organization: "Acme", period: "2023", description: "" }],
  projects: [
    { name: "Blog", url: "https://example.com", description: "This site", tags: ["FastAPI", "Next.js"] },
    { name: "Notes", description: "", tags: [] },
  ],
  site: { title: "Ray's notes", description: "Backend and tooling" },
};

test("form and profile round-trip", () => {
  assert.deepEqual(fromForm(toForm(profile)), profile);
});

test("project tags become comma-separated text and a missing url an empty field", () => {
  const form = toForm(profile);
  assert.equal(form.projects[0]!.tags, "FastAPI, Next.js");
  assert.equal(form.projects[1]!.url, "");
});

test("tags split on ASCII and full-width commas and drop blanks", () => {
  assert.deepEqual(parseTagList(" Go ,Rust，Python、, "), ["Go", "Rust", "Python"]);
  assert.deepEqual(parseTagList(""), []);
});

test("fromForm trims text and leaves out a blank project url", () => {
  const form = toForm(profile);
  form.name = "  Ray ";
  form.projects[0]!.url = "   ";
  const p = fromForm(form);
  assert.equal(p.name, "Ray");
  assert.equal("url" in p.projects[0]!, false);
});

test("fromForm trims the site title and description and keeps an empty description", () => {
  const form = toForm(profile);
  form.site = { title: "  Notes ", description: "   " };
  assert.deepEqual(fromForm(form).site, { title: "Notes", description: "" });
});

test("editing the site fields does not change the loaded profile and makes the form unsaved", () => {
  const form = toForm(profile);
  form.site.title = "Other";
  assert.equal(profile.site.title, "Ray's notes");
  assert.ok(!sameForm(form, toForm(profile)));
});

test("the site title must not be blank and the description may be", () => {
  const form = toForm(profile);
  form.site = { title: " ", description: "" };
  assert.deepEqual(validate(form), { "site.title": "網站名稱不可空白" });
});

test("a valid profile has no errors", () => {
  assert.deepEqual(validate(toForm(profile)), {});
});

test("urls must start with https:// or mailto:", () => {
  for (const url of ["http://example.com", "javascript:alert(1)", "https://", "example.com", ""]) {
    const form = toForm(profile);
    form.links[0]!.url = url;
    assert.match(validate(form)["links.0.url"] ?? "", /https:\/\/ 或 mailto:/, url);
  }
  const form = toForm(profile);
  form.links[0]!.url = "mailto:me@example.com";
  form.projects[0]!.url = "ftp://x";
  assert.deepEqual(Object.keys(validate(form)), ["projects.0.url"]);
});

test("name, link labels, roles and project names must not be blank", () => {
  const form = toForm(profile);
  form.name = " ";
  form.links.push({ ...EMPTY_ROW.links, url: "https://x.example" });
  form.experience.push({ ...EMPTY_ROW.experience });
  form.projects.push({ ...EMPTY_ROW.projects });
  assert.deepEqual(Object.keys(validate(form)).sort(), ["experience.1.role", "links.1.label", "name", "projects.2.name"]);
});

test("move swaps neighbours and ignores moves past either end", () => {
  assert.deepEqual(move(["a", "b", "c"], 1, 0), ["b", "a", "c"]);
  assert.deepEqual(move(["a", "b", "c"], 1, 2), ["a", "c", "b"]);
  assert.deepEqual(move(["a", "b"], 0, -1), ["a", "b"]);
  assert.deepEqual(move(["a", "b"], 1, 2), ["a", "b"]);
});

test("sameForm compares content", () => {
  assert.ok(sameForm(toForm(profile), toForm(profile)));
  const edited = toForm(profile);
  edited.headline = "Frontend";
  assert.ok(!sameForm(edited, toForm(profile)));
});

test("a 422 detail list names the fields", () => {
  const detail = [{ loc: ["body", "content", "links", 0, "url"], msg: "String should match pattern" }];
  assert.equal(describeError(422, detail, "HTTP 422"), "輸入不合法：links.0.url String should match pattern");
  assert.equal(describeError(500, "boom", "boom"), "boom");
});
