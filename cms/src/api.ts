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

export class ApiError extends Error {
  readonly status: number;
  readonly body: { detail?: unknown; current_revision?: number };

  constructor(status: number, body: { detail?: unknown; current_revision?: number }) {
    super(typeof body.detail === "string" ? body.detail : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
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
};

export type DraftApi = Pick<typeof api, "save" | "publish">;
