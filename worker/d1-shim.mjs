// D1 API wrapper over better-sqlite3.
// Memungkinkan kode Worker yang pake D1 (db.mjs, seed.mjs) jalan di Node tanpa perubahan.
import Database from 'better-sqlite3';

export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function makeD1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const exec = (args) => ({
        all() { try { return Promise.resolve({ results: stmt.all(...args) }); } catch (e) { return Promise.reject(e); } },
        first() { try { return Promise.resolve(stmt.get(...args) ?? null); } catch (e) { return Promise.reject(e); } },
        run() {
          try {
            const info = stmt.run(...args);
            return Promise.resolve({ meta: { last_row_id: Number(info.lastInsertRowid) } });
          } catch (e) { return Promise.reject(e); }
        },
      });
      return { ...exec([]), bind: (...args) => exec(args) };
    },
  };
}

