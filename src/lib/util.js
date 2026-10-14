// Seeded RNG (mulberry32) so generated data is identical on every run.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    digits: (n) => Array.from({ length: n }, () => Math.floor(next() * 10)).join(''),
  };
}

// Croatian OIB with a valid ISO 7064 MOD 11,10 check digit.
export function oibCheckDigit(first10) {
  let a = 10;
  for (const ch of first10) {
    a = (a + Number(ch)) % 10;
    if (a === 0) a = 10;
    a = (a * 2) % 11;
  }
  const c = 11 - a;
  return c === 10 ? 0 : c;
}

export function makeOib(rng) {
  let first = String(rng.int(1, 9)) + rng.digits(9);
  return first + oibCheckDigit(first);
}

export function isValidOib(oib) {
  return /^\d{11}$/.test(oib) && oibCheckDigit(oib.slice(0, 10)) === Number(oib[10]);
}

// Money is kept in integer cents everywhere to avoid floating-point drift.
export const cents = (eur) => Math.round(eur * 100);
export const vatOf = (netCents, ratePct) => Math.round((netCents * ratePct) / 100);
export const toEur = (c) => (c / 100).toFixed(2);
export const toHrAmount = (c) =>
  (c / 100).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(';'), ...rows.map((r) => columns.map((c) => esc(r[c])).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
