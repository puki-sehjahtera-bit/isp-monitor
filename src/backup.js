"use strict";
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, "..", "data", "backups");

function backupDb() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "isp_monitor.db");
  if (!fs.existsSync(dbPath)) {
    console.warn("Backup skipped: DB not found at", dbPath);
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dest = path.join(BACKUP_DIR, `isp_monitor_${ts}.db`);
  const walPath = dbPath + "-wal";
  const shmPath = dbPath + "-shm";

  try {
    fs.copyFileSync(dbPath, dest);
    if (fs.existsSync(walPath)) fs.copyFileSync(walPath, dest + "-wal");
    if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, dest + "-shm");
    console.log(`DB backed up → ${dest}`);
  } catch (e) {
    console.error("Backup failed:", e.message);
  }

  cleanupOldBackups();
}

function cleanupOldBackups(maxAgeDays = 1) {
  const maxAge = maxAgeDays * 86400000;
  const now = Date.now();
  try {
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      const fp = path.join(BACKUP_DIR, f);
      if (fs.statSync(fp).isFile() && now - fs.statSync(fp).mtimeMs > maxAge) {
        fs.unlinkSync(fp);
      }
    }
  } catch {}
}

function scheduleBackup(intervalMs = 3600000) {
  backupDb();
  setInterval(backupDb, intervalMs);
  console.log(`DB backup setiap ${intervalMs / 60000} menit ke ${BACKUP_DIR}`);
}

module.exports = { backupDb, scheduleBackup };
