import assert from "node:assert/strict";
import { test } from "node:test";
import { api, isAccessError } from "./api.ts";

globalThis.dispatchEvent = () => true;

function answer(res: Partial<Response>) {
  globalThis.fetch = async () => ({ ok: false, type: "basic", json: async () => ({}), ...res }) as Response;
}

async function sessionError(): Promise<unknown> {
  return api.session().then(
    () => assert.fail("expected the session check to fail"),
    (e: unknown) => e,
  );
}

test("an expired Access session at page load is recognised", async () => {
  answer({ type: "opaqueredirect", status: 0 });
  assert.ok(isAccessError(await sessionError()));
});

test("the backend's Access refusal is recognised", async () => {
  answer({ status: 403, json: async () => ({ detail: "Cloudflare Access sign-in required" }) });
  assert.ok(isAccessError(await sessionError()));
});

test("unreachable Access signing keys are recognised", async () => {
  answer({ status: 503, json: async () => ({ detail: "cannot reach Cloudflare Access to check the sign-in; try again" }) });
  assert.ok(isAccessError(await sessionError()));
});

test("other failures keep the password sign-in", async () => {
  answer({ status: 500, json: async () => ({ detail: "boom" }) });
  assert.ok(!isAccessError(await sessionError()));
  answer({ status: 403, json: async () => ({ detail: "cross-origin request refused" }) });
  assert.ok(!isAccessError(await sessionError()));
});
