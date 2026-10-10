'use strict';
// CSV / JSON export for favorites. Pure text generation (no DOM); downloadFile
// is a thin DOM helper guarded so it stays testable under Node.

function escapeCSV(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // Guard against spreadsheet formula injection.
  const guarded = /^[=+\-@]/.test(s) ? "'" + s : s;
  if (/[",\n\r]/.test(guarded)) return '"' + guarded.replace(/"/g, '""') + '"';
  return guarded;
}

function isoDate(ts) {
  const d = new Date(ts);
  return Number.isFinite(+d) ? d.toISOString().slice(0, 10) : '';
}

function exportFavoritesCSV(favorites) {
  const header = 'handle,name,user_id,tags,note,added_at,updated_at';
  const rows = (favorites || []).map(f => [
    f.handle, f.name, f.userId, (f.tags || []).join('|'), f.note, isoDate(f.addedAt), isoDate(f.updatedAt)
  ].map(escapeCSV).join(','));
  // UTF-8 BOM so Chinese CSV opens correctly in Excel.
  return '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n';
}

function exportFavoritesJSON(favorites) {
  return JSON.stringify({
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    favorites: favorites || []
  }, null, 2);
}

function downloadFile(content, filename, mimeType) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
  const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

module.exports = { escapeCSV, exportFavoritesCSV, exportFavoritesJSON, downloadFile };
