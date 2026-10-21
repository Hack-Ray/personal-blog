import { ApiError, type Draft, type DraftApi, type DraftContent, type Published } from "./api.ts";

export type SyncStatus =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "publishing" }
  | { kind: "conflict"; currentRevision: number }
  | { kind: "error"; message: string };

/**
 * Keeps one article's Working Draft in sync with the server (ART-021).
 * Every request goes through one queue, so each carries the revision the
 * previous one returned, and Publish always sends what the author sees.
 */
export class DraftSync {
  private revision: number;
  private content: DraftContent;
  private dirty = false;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly api: DraftApi;
  private readonly docId: string;
  private readonly onStatus: (s: SyncStatus) => void;
  private readonly debounceMs: number;
  status: SyncStatus = { kind: "saved" };

  constructor(
    api: DraftApi,
    docId: string,
    initial: { revision: number; content: DraftContent },
    onStatus: (s: SyncStatus) => void = () => {},
    debounceMs = 1000,
  ) {
    this.api = api;
    this.docId = docId;
    this.revision = initial.revision;
    this.content = initial.content;
    this.onStatus = onStatus;
    this.debounceMs = debounceMs;
  }

  get current(): DraftContent {
    return this.content;
  }

  private set(status: SyncStatus) {
    this.status = status;
    this.onStatus(status);
  }

  private get blocked(): boolean {
    return this.status.kind === "conflict";
  }

  edit(content: DraftContent): void {
    if (this.blocked) return;
    this.content = content;
    this.dirty = true;
    if (this.status.kind !== "saving" && this.status.kind !== "publishing") this.set({ kind: "dirty" });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  private fail(e: unknown): void {
    if (e instanceof ApiError && e.status === 409 && e.body.current_revision !== undefined) {
      this.set({ kind: "conflict", currentRevision: e.body.current_revision });
    } else {
      this.set({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Saves pending edits now. Resolves once they are stored or have failed. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      if (!this.dirty || this.blocked) return;
      const sent = this.content;
      this.dirty = false;
      this.set({ kind: "saving" });
      try {
        this.revision = (await this.api.save(this.docId, this.revision, sent)).revision;
      } catch (e) {
        this.dirty = true;
        this.fail(e);
        return;
      }
      this.set(this.dirty ? { kind: "dirty" } : { kind: "saved" });
      if (this.dirty) this.timer = setTimeout(() => void this.flush(), this.debounceMs);
    });
  }

  /** Publishes the latest content after any save already in flight. */
  publish(): Promise<Published | undefined> {
    clearTimeout(this.timer);
    return this.enqueue(async () => {
      if (this.blocked) return undefined;
      const sent = this.content;
      this.set({ kind: "publishing" });
      try {
        const published = await this.api.publish(this.docId, this.revision, sent);
        this.revision = published.revision;
        this.dirty = this.content !== sent;
        this.set(this.dirty ? { kind: "dirty" } : { kind: "saved" });
        return published;
      } catch (e) {
        this.fail(e);
        return undefined;
      }
    });
  }

  /** Saves pending edits, then restores a snapshot on the server. */
  restoreSnapshot(snapshotId: number): Promise<Draft | undefined> {
    void this.flush();
    return this.enqueue(async () => {
      if (this.blocked) return undefined;
      this.set({ kind: "saving" });
      try {
        const draft = await this.api.restoreSnapshot(this.docId, this.revision, snapshotId);
        this.revision = draft.revision;
        const { title, topic, tags, markdown, excerpt, cover, series } = draft;
        this.content = { title, topic, tags, markdown, excerpt, cover, series };
        this.dirty = false;
        this.set({ kind: "saved" });
        return draft;
      } catch (e) {
        this.fail(e);
        return undefined;
      }
    });
  }
}
