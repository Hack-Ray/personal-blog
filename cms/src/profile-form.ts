import type { Profile } from "./api.ts";

// Same rule as the backend and the public site's snapshot parser.
const URL_SCHEME = /^(https:\/\/|mailto:)\S+$/;

export interface ProfileForm {
  name: string;
  headline: string;
  intro: string;
  links: { label: string; url: string }[];
  experience: { role: string; organization: string; period: string; description: string }[];
  /** url is "" for none; tags is the comma-separated input */
  projects: { name: string; url: string; description: string; tags: string }[];
}

export const EMPTY_ROW = {
  links: { label: "", url: "" },
  experience: { role: "", organization: "", period: "", description: "" },
  projects: { name: "", url: "", description: "", tags: "" },
};

export const parseTagList = (input: string): string[] =>
  input
    .split(/[,，、]/)
    .map((t) => t.trim())
    .filter(Boolean);

export function toForm(p: Profile): ProfileForm {
  return {
    ...p,
    links: p.links.map((l) => ({ ...l })),
    experience: p.experience.map((e) => ({ ...e })),
    projects: p.projects.map((j) => ({ name: j.name, url: j.url ?? "", description: j.description, tags: j.tags.join(", ") })),
  };
}

export function fromForm(f: ProfileForm): Profile {
  const t = (s: string) => s.trim();
  return {
    name: t(f.name),
    headline: t(f.headline),
    intro: t(f.intro),
    links: f.links.map((l) => ({ label: t(l.label), url: t(l.url) })),
    experience: f.experience.map((e) => ({
      role: t(e.role),
      organization: t(e.organization),
      period: t(e.period),
      description: t(e.description),
    })),
    projects: f.projects.map((j) => ({
      name: t(j.name),
      ...(t(j.url) ? { url: t(j.url) } : {}),
      description: t(j.description),
      tags: parseTagList(j.tags),
    })),
  };
}

/** Problems keyed by field path, e.g. "links.0.url". Empty when the form can be saved. */
export function validate(f: ProfileForm): Record<string, string> {
  const errors: Record<string, string> = {};
  const blank = (s: string) => s.trim() === "";
  const badUrl = (s: string) => !URL_SCHEME.test(s.trim());
  const URL_RULE = "網址必須以 https:// 或 mailto: 開頭";
  if (blank(f.name)) errors.name = "名字不可空白";
  f.links.forEach((l, i) => {
    if (blank(l.label)) errors[`links.${i}.label`] = `連結 ${i + 1}：名稱不可空白`;
    if (badUrl(l.url)) errors[`links.${i}.url`] = `連結 ${i + 1}：${URL_RULE}`;
  });
  f.experience.forEach((e, i) => {
    if (blank(e.role)) errors[`experience.${i}.role`] = `經歷 ${i + 1}：職稱不可空白`;
  });
  f.projects.forEach((j, i) => {
    if (blank(j.name)) errors[`projects.${i}.name`] = `作品 ${i + 1}：名稱不可空白`;
    if (!blank(j.url) && badUrl(j.url)) errors[`projects.${i}.url`] = `作品 ${i + 1}：${URL_RULE}`;
  });
  return errors;
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export const sameForm = (a: ProfileForm, b: ProfileForm) => JSON.stringify(a) === JSON.stringify(b);

/** FastAPI's 422 detail is a list of {loc, msg}; anything else is shown as is. */
export function describeError(status: number, detail: unknown, fallback: string): string {
  if (status === 422 && Array.isArray(detail)) {
    const items = detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(2).join(".")} ${d.msg ?? ""}`.trim());
    return `輸入不合法：${items.join("；")}`;
  }
  return fallback;
}
