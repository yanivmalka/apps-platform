// Pure helpers for reporting by e-mail (reporting-hours): the reminder mail, the reply parser and the code.
// No Firebase here — covered by functions/test/mailParse.test.mjs (node --test).

export const MAILBOX = 'reportinghours.app@gmail.com';
const [LOCAL, DOMAIN] = MAILBOX.split('@');

/** Reply-To address carrying the one-time code: reportinghours.app+<code>@gmail.com */
export function replyAddress(code) {
  return `${LOCAL}+${code}@${DOMAIN}`;
}

/** The code from any of the recipient addresses (To / Delivered-To / X-Original-To). */
export function codeFromAddresses(addresses) {
  const re = new RegExp(`^${LOCAL.replace(/\./g, '\\.')}\\+([a-z0-9]{6,16})@${DOMAIN.replace(/\./g, '\\.')}$`, 'i');
  for (const a of addresses) {
    const m = re.exec(String(a || '').trim().toLowerCase());
    if (m) return m[1];
  }
  return null;
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Random code, 10 chars (no look-alike characters). `rand` — for tests. */
export function makeCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

/**
 * Gmail's own verdict on the sender: Authentication-Results must say dkim=pass or spf=pass,
 * and the From address must be the user's address.
 */
export function senderOk(fromAddress, userEmail, authResults) {
  if (!fromAddress || !userEmail) return false;
  if (fromAddress.trim().toLowerCase() !== userEmail.trim().toLowerCase()) return false;
  const ar = String(authResults || '').toLowerCase();
  return /\bdkim=pass\b/.test(ar) || /\bspf=pass\b/.test(ar);
}

const BIDI = /[‎‏‪-‮⁦-⁩]/g;

/** The user's own text: lines before the quoted original ("> …", "On … wrote:", "בתאריך … כתב/מאת …:"). */
export function ownText(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(BIDI, '').trim();
    if (line.startsWith('>')) break;
    if (/^-{2,}\s*(original message|הודעה מקורית)/i.test(line)) break;
    if (/(wrote|כתב|כתבה|כתב\/ה)\s*:\s*$/i.test(line)) break;
    if (/^(on|בתאריך|ב־?\d).*(<[^>]+@[^>]+>)/i.test(line)) break;
    if (line.toLowerCase().includes(LOCAL)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

const pad = n => String(n).padStart(2, '0');
const hhmm = (h, m) => `${pad(Number(h))}:${pad(Number(m))}`;
const validTime = (h, m) => Number(h) <= 23 && Number(m) <= 59;

/**
 * The reply → what to record. `planned`: { start, end, breakMinutes }.
 *   held     — "כן" / "התקיים" / "אישור": the planned times.
 *   times    — "8:30-11:45" (optional "הפסקה 15" / "בלי הפסקה"): actual times.
 *   canceled — "בוטל <סיבה>" / "לא התקיים <סיבה>".
 *   unknown  — anything else (nothing is recorded; the user gets an explanation).
 */
export function parseReply(text, planned) {
  const t = ownText(text);
  const first = t.split('\n').find(l => l.trim()) ?? '';
  const all = t.replace(/\n+/g, ' ').trim();

  const cancel = /^(בוטל|לא\s+התקיים|ביטול)\s*[:,.\-–—]?\s*(.*)$/.exec(first.trim());
  if (cancel) return { kind: 'canceled', reason: cancel[2].trim().slice(0, 80) };

  const range = /(\d{1,2})[:.](\d{2})\s*(?:-|–|—|עד)\s*(\d{1,2})[:.](\d{2})/.exec(all);
  if (range) {
    const [, h1, m1, h2, m2] = range;
    if (!validTime(h1, m1) || !validTime(h2, m2)) return { kind: 'unknown' };
    const start = hhmm(h1, m1);
    const end = hhmm(h2, m2);
    if (end <= start) return { kind: 'unknown' };
    let breakMinutes = planned?.breakMinutes ?? 0;
    if (/(בלי|ללא)\s+הפסק/.test(all)) breakMinutes = 0;
    const b = /הפסק(?:ה|ות)\s*(?:של\s*)?(\d{1,3})/.exec(all) || /(\d{1,3})\s*(?:דק(?:ות|['׳])?)\s*הפסק/.exec(all);
    if (b) breakMinutes = Number(b[1]);
    return { kind: 'times', start, end, breakMinutes };
  }

  if (/^(כן|התקיים|התקיימה|אישור|מאשר|מאשרת|ok|okay|yes|v|✓|✔|👍)(\s|[.!,]|$)/i.test(first.trim())) {
    if (!planned) return { kind: 'unknown' };
    return { kind: 'held', start: planned.start, end: planned.end, breakMinutes: planned.breakMinutes ?? 0 };
  }
  return { kind: 'unknown' };
}

const dayName = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
/** "יום שלישי 17.11.2026" */
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `יום ${dayName[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d}.${m}.${y}`;
}

/** The reminder mail for one unreported session. */
export function reminderMail(item, date, code) {
  const breaks = item.breakMinutes ? `הפסקה ${item.breakMinutes} דק׳` : 'בלי הפסקה';
  const subject = `דיווח שעות: ${item.courseName} · ${dayLabel(date)} [${code}]`;
  const text = [
    'שלום,',
    '',
    `המפגש של היום עוד לא דווח:`,
    `${item.courseName} · ${item.workplaceName}`,
    `${dayLabel(date)} · ${item.start}–${item.end} · ${breaks}`,
    '',
    'אפשר לדווח בתשובה למייל הזה (רק מהכתובת שלך). כתבו בשורה הראשונה:',
    '  כן — התקיים לפי התכנון',
    `  ${item.start}-${item.end} הפסקה ${item.breakMinutes || 0} — שעות בפועל`,
    '  בוטל מחלה — לא התקיים (עם סיבה)',
    '',
    `הקוד של ההודעה: ${code}. אפשר לענות פעם אחת, עד 7 ימים.`,
    'הדיווח נרשם מיד, ויופיע בכל המכשירים בסנכרון הבא.',
  ].join('\n');
  return { subject, text };
}

/** The confirmation reply. */
export function confirmationMail(parsed, item, date) {
  const what =
    parsed.kind === 'canceled'
      ? `סומן כבוטל${parsed.reason ? ` · ${parsed.reason}` : ''}`
      : `נרשם: ${parsed.start}–${parsed.end}${parsed.breakMinutes ? ` · הפסקה ${parsed.breakMinutes} דק׳` : ''}`;
  return {
    subject: `התקבל — ${item.courseName} · ${dayLabel(date)}`,
    text: [`${what}`, `${item.courseName} · ${item.workplaceName} · ${dayLabel(date)}`, '', 'לתיקון — באפליקציה, בתצוגת הדיווח.'].join('\n'),
  };
}

/** The explanation when a reply was not understood / not accepted. */
export function rejectionMail(reason) {
  const why = {
    unknown: 'לא הצלחנו להבין את התשובה.',
    code: 'הקוד של ההודעה לא נמצא, כבר שומש או שפג תוקפו.',
    sender: 'התשובה לא הגיעה מהכתובת שרשומה באפליקציה.',
  }[reason];
  return {
    subject: 'הדיווח לא נקלט',
    text: [
      why,
      '',
      'אפשר לענות שוב למייל המקורי, בשורה הראשונה:',
      '  כן',
      '  8:30-11:45 הפסקה 15',
      '  בוטל מחלה',
      '',
      'או לדווח ישירות באפליקציה.',
    ].join('\n'),
  };
}
