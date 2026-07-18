import test from "node:test";
import assert from "node:assert/strict";
import { checkHttp, checkPing, checkStatusPage } from "../worker/checks.mjs";

test("checkHttp url invalid -> ok:false", async () => {
  const r = await checkHttp("not-a-url");
  assert.equal(r.ok, false);
  assert.match(r.err, /invalid url/);
});

test("checkPing tanpa target -> ok:false", async () => {
  const r = await checkPing("");
  assert.equal(r.ok, false);
});

test("checkStatusPage tanpa url -> ok:true, incident:false", async () => {
  const r = await checkStatusPage("");
  assert.equal(r.ok, true);
  assert.equal(r.incident, false);
});
