"use strict";
const API_BASE = "https://api.twitter.com/2";

async function postTweet(text) {
  const key = process.env.TWITTER_API_KEY;
  const secret = process.env.TWITTER_API_SECRET;
  const token = process.env.TWITTER_ACCESS_TOKEN;
  const tsecret = process.env.TWITTER_ACCESS_SECRET;
  if (!key || !secret || !token || !tsecret) return;

  const bearer = Buffer.from(`${key}:${secret}`).toString("base64");
  let t;
  try {
    const r = await fetch(`${API_BASE}/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${bearer}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const j = await r.json();
    t = j.access_token;
  } catch { return; }
  if (!t) return;

  try {
    await fetch(`${API_BASE}/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 280) }),
    });
  } catch {}
}

async function checkAndTweet() {
  const db = require("./db");
  const threshold = parseFloat(process.env.TWEET_UPTIME_THRESHOLD || "90");
  const alerted = new Set(JSON.parse(process.env._TWEET_ALERTED || "[]"));

  for (const isp of db.getAllIsps()) {
    const day = new Date().toISOString().slice(0, 10);
    const row = db.db.prepare(
      "SELECT uptime_percent FROM isp_uptime_cache WHERE isp_id = ? AND check_date = ?"
    ).get(isp.id, day);
    if (!row || row.uptime_percent >= threshold) {
      alerted.delete(isp.id);
      continue;
    }
    if (alerted.has(isp.id)) continue;
    alerted.add(isp.id);
    const msg = `⚠️ ${isp.name} (${isp.country}) — uptime ${row.uptime_percent.toFixed(1)}% hari ini (di bawah ${threshold}%). Pantau realtime: ${process.env.SHARE_URL || "https://ispmonitor.my.id"}`;
    await postTweet(msg);
    console.info("Tweeted alert for", isp.name);
  }

  process.env._TWEET_ALERTED = JSON.stringify([...alerted]);
}

module.exports = { checkAndTweet, postTweet };
