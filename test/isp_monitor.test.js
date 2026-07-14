"use strict";
// Tes minimal untuk layer DB + checks (tanpa network eksternal).
// Jalankan: node --test
process.env.DATA_DIR = require("path").join(require("os").tmpdir(), "isp-monitor-test-" + Date.now());
const test = require("node:test");
const assert = require("node:assert");
const db = require("../src/db");
const { checkHttp, checkPing } = require("../src/checks");

test("getOrCreateIsp idempoten", () => {
  const id1 = db.getOrCreateIsp({ name: "Test ISP", country: "ID", http_url: "https://example.com" });
  const id2 = db.getOrCreateIsp({ name: "Test ISP", country: "ID", http_url: "https://example.com" });
  assert.strictEqual(id1, id2);
  assert.ok(id1 > 0);
});

test("updateIspStatus + getLatestByProbe", () => {
  const id = db.getOrCreateIsp({ name: "Probe ISP", country: "ID" });
  db.updateIspStatus(id, "combined", 1, 12, "local");
  const latest = db.getLatestByProbe(id);
  assert.strictEqual(latest.local, true);
});

test("getDashboard mengembalikan array", () => {
  assert.ok(Array.isArray(db.getDashboard()));
});

test("checkPing tanpa ip -> ok:false", async () => {
  const r = await checkPing("");
  assert.strictEqual(r.ok, false);
});

test("checkHttp url invalid -> ok:false", async () => {
  const r = await checkHttp("not-a-url");
  assert.strictEqual(r.ok, false);
});
