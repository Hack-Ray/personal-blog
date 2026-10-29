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
  /** "" lets the public site use the start of the article. */
  excerpt: string;
  /** An image id the Markdown references; null means its first image. */
  cover: string | null;
  series: Taxon | null;
}

export const EMPTY_METADATA = { excerpt: "", cover: null, series: null } satisfies Partial<DraftContent>;

export interface Draft extends DraftContent {
  doc_id: string;
  /** The public URL segment; null means the doc_id. Saved on its own, not with the draft. */
  slug: string | null;
  state: ArticleState;
  revision: number;
  updated_at: string;
}

export interface ArticleSummary {
  doc_id: string;
  state: ArticleState;
  title: string;
  pinned: boolean;
  slug: string | null;
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
  dispatched_at: string | null;
}

export interface ReleaseJob {
  id: string;
  action: "create" | "retry";
  requested_release_id: string | null;
  release_id: string | null;
  status: "queued" | "running" | "completed" | "failed";
  detail: string | null;
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
  /** The site name, description and footer text on the public site; description and footer may be "". */
  site: { title: string; description: string; footer: string };
}

export type TaxonKind = "topics" | "tags" | "series";

export interface TaxonUsage extends Taxon {
  /** Live articles whose draft uses it. */
  articles: number;
  /** False once no draft or kept published version refers to it, so it can be deleted. */
  in_use: boolean;
}

export interface SavedProfile {
  revision: number;
  content: Profile;
  updated_at: string;
}

export type AnalyticsSourceName = "cloudflare" | "search_console";

export interface SourceStatus {
  source: AnalyticsSourceName;
  configured: boolean;
  /** The last successful sync. */
  synced_at: string | null;
  attempted_at: string | null;
  /** Why the latest attempt failed; null once a sync succeeds. */
  error: string | null;
  /** Configured and older than the backend's refresh interval. */
  stale: boolean;
}

export interface SearchItem {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

/** Days are UTC dates (YYYY-MM-DD); a day without data has no row. */
export interface AnalyticsReport {
  start: string;
  end: string;
  sources: SourceStatus[];
  traffic: { day: string; requests: number; page_views: number; visitors: number; bytes: number }[];
  traffic_totals: { requests: number; page_views: number; visitors: number; bytes: number; cache_hit_ratio: number | null };
  search: { day: string; clicks: number; impressions: number; ctr: number | null; position: number | null }[];
  search_totals: { clicks: number; impressions: number; ctr: number | null; position: number | null };
  top_queries: SearchItem[];
  top_pages: SearchItem[];
}

type ErrorBody = { detail?: unknown; current_revision?: number; suggestion?: string };

export class ApiError extends Error {
  readonly status: number;
  readonly body: ErrorBody;

  constructor(status: number, body: ErrorBody) {
    super(typeof body.detail === "string" ? body.detail : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Fired when the session ends mid-use, and once the author signs in again.
export const SIGNED_OUT = "cms:signed-out";
export const SIGNED_IN = "cms:signed-in";

export type SignInMethod = "password" | "cloudflare";
export const ACCESS_LOGOUT = "/cdn-cgi/access/logout";
const ACCESS_REQUIRED = "Cloudflare Access sign-in required";

// Only a CMS behind Cloudflare Access answers like this, so a failed first
// session check can still tell which sign-in screen to show.
export function isAccessError(e: unknown): boolean {
  return e instanceof ApiError && (e.message === ACCESS_REQUIRED || (e.status === 503 && e.message.includes("Cloudflare Access")));
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" },
    body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
    // The API never redirects; Cloudflare Access does once its session has
    // expired, towards a sign-in page fetch cannot follow.
    redirect: "manual",
  });
  if (res.type === "opaqueredirect") {
    dispatchEvent(new Event(SIGNED_OUT));
    throw new ApiError(res.status, { detail: ACCESS_REQUIRED });
  }
  if (!res.ok) {
    const error = new ApiError(res.status, await res.json().catch(() => ({})));
    if ((res.status === 401 && path !== "/session") || (res.status === 403 && error.message === ACCESS_REQUIRED)) dispatchEvent(new Event(SIGNED_OUT));
    throw error;
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  session: () => request<{ signed_in: boolean; method: SignInMethod }>("GET", "/session"),
  signIn: (password: string) => request<void>("POST", "/session", { password }),
  signOut: () => request<void>("DELETE", "/session"),
  signOutEverywhere: () => request<void>("DELETE", "/sessions"),
  list: (state?: ArticleState) => request<ArticleSummary[]>("GET", `/articles${state ? `?state=${state}` : ""}`),
  create: (content: DraftContent) => request<Draft>("POST", "/articles", content),
  draft: (docId: string) => request<Draft>("GET", `/articles/${docId}/draft`),
  save: (docId: string, baseRevision: number, content: DraftContent) =>
    request<Draft>("PUT", `/articles/${docId}/draft`, { ...content, base_revision: baseRevision }),
  publish: (docId: string, baseRevision: number, content: DraftContent) =>
    request<Published>("POST", `/articles/${docId}/publish`, { ...content, base_revision: baseRevision }),
  setSlug: (docId: string, slug: string | null) => request<ArticleSummary>("PUT", `/articles/${docId}/slug`, { slug }),
  setPinned: (docId: string, pinned: boolean) => request<ArticleSummary>("PUT", `/articles/${docId}/pinned`, { pinned }),
  archive: (docId: string) => request<ArticleSummary>("POST", `/articles/${docId}/archive`),
  remove: (docId: string) => request<ArticleSummary>("DELETE", `/articles/${docId}`),
  restore: (docId: string) => request<ArticleSummary>("POST", `/articles/${docId}/restore`),
  purge: (docId: string) => request<void>("POST", `/articles/${docId}/purge`),
  snapshots: (docId: string) => request<Snapshot[]>("GET", `/articles/${docId}/snapshots`),
  restoreSnapshot: (docId: string, baseRevision: number, snapshotId: number) =>
    request<Draft>("POST", `/articles/${docId}/snapshots/${snapshotId}/restore`, { base_revision: baseRevision }),
  /** Lists releases after asking GitHub how the dispatched ones are doing. */
  releases: () => request<Release[]>("POST", "/releases/refresh"),
  githubToken: () => request<{ configured: boolean; expires_at: string | null }>("GET", "/github-token"),
  releaseJobs: () => request<ReleaseJob[]>("GET", "/release-jobs"),
  submitRelease: (releaseId?: string) => request<ReleaseJob>("POST", "/release-jobs", releaseId ? { action: "retry", release_id: releaseId } : { action: "create" }),
  githubStatus: () => request<{ incidents: { name: string; url: string }[] }>("GET", "/github-status"),
  profile: () => request<SavedProfile>("GET", "/profile"),
  saveProfile: (revision: number, content: Profile) => request<SavedProfile>("PUT", "/profile", { revision, content }),
  taxa: () => request<Record<TaxonKind, TaxonUsage[]>>("GET", "/taxa"),
  renameTaxon: (kind: TaxonKind, slug: string, name: string) => request<void>("PUT", `/taxa/${kind}/${slug}`, { name }),
  mergeTaxon: (kind: TaxonKind, slug: string, into: string) => request<void>("POST", `/taxa/${kind}/${slug}/merge`, { into }),
  deleteTaxon: (kind: TaxonKind, slug: string) => request<void>("DELETE", `/taxa/${kind}/${slug}`),
  analytics: (days: number) => request<AnalyticsReport>("GET", `/analytics?days=${days}`),
  /** Fetches the stale sources from Cloudflare and Google, or every configured one with `force`. */
  syncAnalytics: (force: boolean) => request<SourceStatus[]>("POST", "/analytics/sync", { force }),
  uploadImage: (file: Blob) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ id: string; markdown: string }>("POST", "/images", form);
  },
};

export type DraftApi = Pick<typeof api, "draft" | "save" | "publish" | "restoreSnapshot">;
