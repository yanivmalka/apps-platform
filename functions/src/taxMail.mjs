// Pure helpers for sending a tax-coordination form from the server (reporting-hours).
// Spec: yanivmalka/Reporting-hours docs/fixes-spec-2026-11-17.md §3.
// No Firebase here — covered by functions/test/taxMail.test.mjs (node --test).

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** A plain, single e-mail address (no display name, no lists). */
export function validEmail(s) {
  return typeof s === 'string' && s.length <= 254 && EMAIL_RE.test(s.trim());
}

/** Year of a tax form: a 4-digit Gregorian year in a sane range. */
export function validYear(y) {
  return typeof y === 'string' && /^20\d\d$/.test(y);
}

/** The form file must sit in the user's own tax folder (never another user's file). */
export function ownTaxPath(path, app, uid) {
  const prefix = `apps/${app}/users/${uid}/files/tax/`;
  return typeof path === 'string' && path.startsWith(prefix) && !path.includes('..') && path.length > prefix.length;
}

/** Safe file name for the attachment: keeps the extension, drops path parts and control characters. */
export function attachmentName(name, year, ext) {
  const clean = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"]/g, '').trim();
  return clean || `tax-coordination-${year}.${ext || 'pdf'}`;
}

/**
 * The mail itself. Recipients come only from the workplace saved in the user's data (payrollEmail + ccEmails),
 * never from the request — so the mailbox cannot be used to send files to arbitrary addresses.
 * The user gets a copy (Cc) and replies from the institution reach them directly (Reply-To).
 *
 * workplace: { name, payrollEmail, ccEmails?, employeeNumber? }
 * user:      { name, email }
 * → { to, cc, replyTo, fromName, subject, text } or { error: 'noRecipient' | 'noUserEmail' }
 */
export function taxMail(workplace, year, user) {
  const to = String(workplace?.payrollEmail || '').trim();
  if (!validEmail(to)) return { error: 'noRecipient' };
  const userEmail = String(user?.email || '').trim();
  if (!validEmail(userEmail)) return { error: 'noUserEmail' };
  const name = String(user?.name || '').trim().slice(0, 80);
  const lower = new Set([to.toLowerCase()]);
  const cc = [];
  for (const raw of [...(Array.isArray(workplace.ccEmails) ? workplace.ccEmails : []), userEmail]) {
    const a = String(raw || '').trim();
    if (!validEmail(a) || lower.has(a.toLowerCase())) continue;
    lower.add(a.toLowerCase());
    cc.push(a);
    if (cc.length >= 6) break;
  }
  const emp = String(workplace.employeeNumber || '').trim().slice(0, 30);
  const subject = `טופס תיאום מס ${year}${name ? ` — ${name}` : ''}`;
  const text = [
    'שלום,',
    '',
    `מצורף טופס תיאום מס לשנת ${year}${emp ? ` (מספר עובד ${emp})` : ''}.`,
    '',
    'בברכה,',
    name,
    '',
    '—',
    `נשלח מאפליקציית "דיווח שעות" בשם ${name || userEmail}. תשובה למייל הזה תגיע אל ${userEmail}.`,
  ].join('\n');
  return { to, cc, replyTo: userEmail, fromName: name || 'דיווח שעות', subject, text };
}

/** Daily limit per user (protects the shared mailbox's sending quota). */
export const TAX_SENDS_PER_DAY = 10;

/** Counter for today: { date, count } → whether another send is allowed, and the next value. */
export function nextQuota(current, today, limit = TAX_SENDS_PER_DAY) {
  const count = current?.date === today ? Number(current.count) || 0 : 0;
  if (count >= limit) return { ok: false };
  return { ok: true, value: { date: today, count: count + 1 } };
}
