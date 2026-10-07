import Database from 'better-sqlite3';
import path from 'node:path';

// Read only metadata. Never fetch image bytes or expose storage credentials.
const db = new Database(path.join(process.env.DATA_DIR || path.resolve('data'), 'gallery.sqlite'), {readonly: true});
try {
  const status = db.transaction(() => {
    const limitBytes = Number(process.env.MAX_STORAGE_BYTES || 10737418240);
    const usedBytes = db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM assets').get().n;
    const reservedBytes = db.prepare('SELECT COALESCE(SUM(bytes),0) AS n FROM storage_reservations WHERE expires>=?').get(Date.now()).n;
    const quotaBlocked = db.prepare("SELECT blocked_at AS blockedAt, used_bytes AS usedBytes, reserved_bytes AS reservedBytes, requested_bytes AS requestedBytes, limit_bytes AS limitBytes FROM storage_alerts WHERE id='quota' AND limit_bytes=?").get(limitBytes) || null;
    return {limitBytes, usedBytes, reservedBytes, remainingBytes: Math.max(0, limitBytes-usedBytes-reservedBytes), quotaBlocked};
  })();
  console.log(JSON.stringify(status));
} finally {
  db.close();
}
