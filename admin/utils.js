const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

function toBrt(date) {
  return new Date(date.getTime() - BRT_OFFSET_MS);
}

function brtFields(date) {
  const brt = toBrt(date);
  return {
    year: brt.getUTCFullYear(),
    month: brt.getUTCMonth(),
    day: brt.getUTCDate(),
    weekday: brt.getUTCDay()
  };
}

function makeDateFromBrt(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month, day, hour + 3, minute, second));
}

function parseISO(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseYMD(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  return makeDateFromBrt(year, month, day, 0, 0, 0);
}

function formatBrtDate(date) {
  if (!date) return '';
  const f = brtFields(date);
  const dd = String(f.day).padStart(2, '0');
  const mm = String(f.month + 1).padStart(2, '0');
  return `${dd}/${mm}/${f.year}`;
}

function formatBrtTime(date) {
  if (!date) return '';
  const brt = toBrt(date);
  const hh = String(brt.getUTCHours()).padStart(2, '0');
  const mm = String(brt.getUTCMinutes()).padStart(2, '0');
  const ss = String(brt.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatBrtDateTime(date) {
  return `${formatBrtDate(date)} ${formatBrtTime(date)}`.trim();
}

function formatYMD(dateStr) {
  const d = parseYMD(dateStr);
  return d ? formatBrtDate(d) : '';
}

function downloadCsv(filename, rows) {
  const content = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

window.AdminUtils = {
  brtFields,
  makeDateFromBrt,
  parseISO,
  parseYMD,
  formatBrtDate,
  formatBrtTime,
  formatBrtDateTime,
  formatYMD,
  downloadCsv
};
