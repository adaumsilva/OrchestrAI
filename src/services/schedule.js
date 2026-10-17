// Pure schedule arithmetic for routines (no Electron), so it can be unit tested with plain node.
// schedule: { kind: 'once', at } | { kind: 'every', minutes, anchor } | { kind: 'daily', time: 'HH:MM' } | { kind: 'weekly', time: 'HH:MM', days: [0-6, 0 = Sunday] }

function parseTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh < 24 && mm < 60 ? { hh, mm } : null;
}

function validate(s) {
  if (!s || typeof s !== 'object') return 'Missing schedule';
  switch (s.kind) {
    case 'once': return Number.isFinite(s.at) ? null : 'Pick a date and time';
    case 'every': return Number.isFinite(s.minutes) && s.minutes >= 1 ? null : 'Interval must be at least 1 minute';
    case 'daily': return parseTime(s.time) ? null : 'Time must be HH:MM';
    case 'weekly': return parseTime(s.time) && Array.isArray(s.days) && s.days.length && s.days.every((d) => d >= 0 && d <= 6) ? null : 'Pick a time and at least one weekday';
    default: return 'Unknown schedule kind';
  }
}

// First run time strictly after `from` (ms), or null when the schedule has no further runs.
function nextRun(s, from) {
  if (validate(s)) return null;
  switch (s.kind) {
    case 'once': return s.at > from ? s.at : null;
    case 'every': {
      const step = s.minutes * 60000, anchor = Number.isFinite(s.anchor) ? s.anchor : from;
      if (from < anchor) return anchor;
      return anchor + (Math.floor((from - anchor) / step) + 1) * step;
    }
    case 'daily':
    case 'weekly': {
      const { hh, mm } = parseTime(s.time);
      const days = s.kind === 'weekly' ? s.days : [0, 1, 2, 3, 4, 5, 6];
      const d = new Date(from);
      for (let i = 0; i <= 8; i++) {
        const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, hh, mm, 0, 0);
        if (c.getTime() > from && days.includes(c.getDay())) return c.getTime();
      }
      return null;
    }
  }
  return null;
}

function describe(s) {
  switch (s?.kind) {
    case 'once': return 'Once, ' + new Date(s.at).toLocaleString();
    case 'every': return s.minutes % 60 === 0 ? `Every ${s.minutes / 60} h` : `Every ${s.minutes} min`;
    case 'daily': return `Daily at ${s.time}`;
    case 'weekly': return `${s.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' ')} at ${s.time}`;
  }
  return '';
}

module.exports = { nextRun, validate, describe, parseTime };
