import assert from "node:assert/strict";
import { test } from "node:test";
import { jobMessage, jobPending } from "./release-job.ts";
import type { ReleaseJob } from "./api.ts";

const job = (status: ReleaseJob["status"], release_id: string | null = null, detail: string | null = null): ReleaseJob => ({
  id: "job", action: "create", requested_release_id: null, release_id, status, detail, created_at: "", updated_at: "",
});

test("queued and running website updates keep submission disabled after a page reload", () => {
  assert.equal(jobPending(job("queued")), true);
  assert.equal(jobPending(job("running")), true);
  assert.equal(jobPending(job("completed")), false);
  assert.equal(jobPending(job("failed")), false);
});

test("job completion distinguishes unchanged content from a submitted deployment", () => {
  assert.match(jobMessage(job("completed")), /沒有變更/);
  assert.match(jobMessage(job("completed", "release")), /建置與上線狀態/);
  assert.equal(jobMessage(job("failed", null, "remote conflict")), "remote conflict");
  assert.match(jobMessage(job("queued")), /可以離開/);
});
