export type ArticleState = "draft" | "published" | "archived" | "pending_deletion";

export interface Taxon {
  slug: string;
  name: string;
}

export interface DraftContent {
  title: string;
  topic: Taxon;
  tags: Taxon[];
  markdown: string;
}

export interface Draft extends DraftContent {
  doc_id: string;
  state: ArticleState;
  revision: number;
  updated_at: string;
}

export interface ArticleSummary {
  doc_id: string;
  state: ArticleState;
  title: string;
  deleted_at: string | null;
  purge_after: string | null;
}

export interface Published {
  doc_id: string;
  version: number;
  revision: number;
  published_at: string;
}

export interface Snapshot {
  id: number;
  revision: number;
  markdown: string;
  created_at: string;
}

export type ReleaseStatus =
  | "exported"
  | "push_failed"
  | "pushed"
  | "dispatch_failed"
  | "dispatched"
  | "building"
  | "deployed"
  | "superseded"
  | "failed";

export interface Release {
  id: string;
  content_commit: string;
  status: ReleaseStatus;
  detail: string | null;
  run_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  name: string;
  headline: string;
  intro: string;
  links: { label: string; url: string }[];
  experience: { role: string; organization: string; period: string; description: string }[];
  projects: { name: string; url?: string; description: string; tags: string[] }[];
  /** The site name and description on the public site; description may be "". */
  site: { title: string; description: string };
}

export interface SavedProfile {
  revision: number;
  content: Profile;
  updated_at: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: { detail?: unknown; current_revision?: number };

  constructor(status: number, body: { detail?: unknown; current_revision?: number }) {
    super(typeof body.detail === "string" ? body.detail : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Fired when the session ends mid-use, and once the author signs in again.
export const SIGNED_OUT = "cms:signed-out";
export const SIGNED_IN = "cms:signed-in";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" },
    body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
  });
  if (res.status === 401 && path !== "/session") dispatchEvent(new Event(SIGNED_OUT));
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  session: () => request<{ signed_in: boolean }>("GET", "/session"),
  signIn: (password: string) => request<void>("POST", "/session", { password }),
  signOut: () => request<void>("DELETE", "/session"),
  list: (state?: ArticleState) => request<ArticleSummary[]>("GET", `/articles${state ? `?state=${state}` : ""}`),
  create: (content: DraftContent) => request<Draft>("POST", "/articles", content),
  draft: (docId: string) => request<Draft>("GET", `/articles/${docId}/draft`),
  save: (docId: string, baseRevision: number, content: DraftContent) =>
    request<Draft>("PUT", `/articles/${docId}/draft`, { ...content, base_revision: baseRevision }),
  publish: (docId: string, baseRevision: number, content: DraftContent) =>
    request<Published>("POST", `/articles/${docId}/publish`, { ...content, base_revision: baseRevision }),
  archive: (docId: string) => request<ArticleSummary>("POST", `/articles/${docId}/archive`),
  remove: (docId: string) => request<ArticleSummary>("DELETE", `/articles/${docId}`),
  restore: (docId: string) => request<ArticleSummary>("POST", `/articles/${docId}/restore`),
  purge: (docId: string) => request<void>("POST", `/articles/${docId}/purge`),
  snapshots: (docId: string) => request<Snapshot[]>("GET", `/articles/${docId}/snapshots`),
  restoreSnapshot: (docId: string, baseRevision: number, snapshotId: number) =>
    request<Draft>("POST", `/articles/${docId}/snapshots/${snapshotId}/restore`, { base_revision: baseRevision }),
  releases: () => request<Release[]>("GET", "/releases"),
  createRelease: () => request<{ release: Release | null }>("POST", "/releases"),
  retryRelease: (id: string) => request<Release>("POST", `/releases/${id}/retry`),
  profile: () => request<SavedProfile>("GET", "/profile"),
  saveProfile: (revision: number, content: Profile) => request<SavedProfile>("PUT", "/profile", { revision, content }),
  uploadImage: (file: Blob) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ id: string; markdown: string }>("POST", "/images", form);
  },
};

export type DraftApi = Pick<typeof api, "save" | "publish" | "restoreSnapshot">;
