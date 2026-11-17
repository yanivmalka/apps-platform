// Cloud Functions for the apps platform. First: reporting by e-mail for reporting-hours
// (spec: yanivmalka/Reporting-hours docs/fixes-spec-2026-11-17.md §8).
//
// Mailbox reportinghours.app@gmail.com, App Password in the secret GMAIL_APP_PASSWORD.
//   mailSend  (every 15 min) — for each user who enabled it: after their send time, one mail per session of
//             today that is still unreported, with a one-time code in the Reply-To (reportinghours.app+<code>@…).
//   mailPoll  (every 5 min)  — reads new mail over IMAP; a reply is accepted only with a valid unused code, from
//             the user's address, with Gmail's DKIM/SPF pass. The parsed reply goes to the user's mailInbox; the
//             app imports it as a report (or a cancellation) on next open. The sender gets a confirmation.
//
// Data (Firestore):
//   apps/reporting-hours/users/{uid}/mail/plan     ← written by the app: { enabled, email, sendTime, days: {date: [item]} }
//   apps/reporting-hours/users/{uid}/mail/sent     ← { sent: { "<courseId>|<date>": code } }
//   apps/reporting-hours/users/{uid}/mailInbox/{id} ← parsed replies, status 'new' → 'imported' (by the app)
//   apps/reporting-hours/mailCodes/{code}          ← server only (no client rule matches)
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  MAILBOX,
  codeFromAddresses,
  confirmationMail,
  makeCode,
  parseReply,
  rejectionMail,
  reminderMail,
  replyAddress,
  senderOk,
} from './mailParse.mjs';

initializeApp();
const db = getFirestore();
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
const APP = 'apps/reporting-hours';
const TZ = 'Asia/Jerusalem';
const CODE_DAYS = 7;

/** Local date and time in Israel: { date: 'YYYY-MM-DD', time: 'HH:MM' } */
function nowLocal(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}

function transport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: MAILBOX, pass: GMAIL_APP_PASSWORD.value() },
  });
}

/** The user's reports (synced kv doc) — to skip sessions that were already reported. */
async function reportedKeys(uid) {
  const snap = await db.doc(`${APP}/users/${uid}/kv/reports~v1`).get();
  const out = new Set();
  try {
    for (const r of JSON.parse(snap.get('v') || '[]')) if (r.courseId) out.add(`${r.courseId}|${r.date}`);
  } catch { /* unreadable — treat as none */ }
  return out;
}

export const mailSend = onSchedule(
  { schedule: 'every 15 minutes', timeZone: TZ, secrets: [GMAIL_APP_PASSWORD], retryCount: 0 },
  async () => {
    const { date, time } = nowLocal();
    const plans = await db.collectionGroup('mail').get();
    let mailer = null;
    for (const doc of plans.docs) {
      if (doc.id !== 'plan' || !doc.ref.path.startsWith(`${APP}/users/`)) continue;
      const plan = doc.data();
      if (!plan.enabled || !plan.email || time < (plan.sendTime || '21:00')) continue;
      const items = plan.days?.[date] ?? [];
      if (!items.length) continue;
      const uid = doc.ref.parent.parent.id;
      const sentRef = db.doc(`${APP}/users/${uid}/mail/sent`);
      const sent = (await sentRef.get()).get('sent') ?? {};
      const reported = await reportedKeys(uid);
      for (const item of items) {
        const key = `${item.courseId}|${date}`;
        if (sent[key] || reported.has(key)) continue;
        const code = makeCode();
        await db.doc(`${APP}/mailCodes/${code}`).set({
          uid, email: plan.email.toLowerCase(), date, item, used: false,
          expires: Date.now() + CODE_DAYS * 86_400_000, created: Date.now(),
        });
        const m = reminderMail(item, date, code);
        mailer ??= transport();
        await mailer.sendMail({
          from: { name: 'דיווח שעות', address: MAILBOX }, to: plan.email, replyTo: replyAddress(code),
          subject: m.subject, text: m.text,
        });
        await sentRef.set({ sent: { [key]: code } }, { merge: true });
        logger.info('reminder sent', { uid, key });
      }
    }
  },
);

export const mailPoll = onSchedule(
  { schedule: 'every 5 minutes', timeZone: TZ, secrets: [GMAIL_APP_PASSWORD], retryCount: 0 },
  async () => {
    const client = new ImapFlow({
      host: 'imap.gmail.com', port: 993, secure: true, logger: false,
      auth: { user: MAILBOX, pass: GMAIL_APP_PASSWORD.value() },
    });
    await client.connect();
    const mailer = transport();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      for (const msgUid of uids || []) {
        const msg = await client.fetchOne(String(msgUid), { source: true }, { uid: true });
        try {
          await handleReply(await simpleParser(msg.source), mailer);
        } catch (e) {
          logger.error('reply failed', { msgUid, error: String(e) });
        }
        await client.messageFlagsAdd(String(msgUid), ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
      await client.logout();
    }
  },
);

function header(parsed, name) {
  const v = parsed.headers.get(name);
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(x => (typeof x === 'string' ? x : x?.text ?? x?.value?.[0]?.address ?? ''));
}

async function handleReply(parsed, mailer) {
  const from = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
  if (!from || from === MAILBOX) return;
  const recipients = [
    ...(parsed.to?.value ?? []).map(a => a.address),
    ...(parsed.cc?.value ?? []).map(a => a.address),
    ...header(parsed, 'delivered-to'),
    ...header(parsed, 'x-original-to'),
  ];
  const reply = async (m, code) =>
    mailer.sendMail({
      from: { name: 'דיווח שעות', address: MAILBOX }, to: from,
      replyTo: code ? replyAddress(code) : undefined,
      subject: m.subject, text: m.text,
      inReplyTo: parsed.messageId, references: parsed.messageId,
    });

  const code = codeFromAddresses(recipients);
  const codeRef = code ? db.doc(`${APP}/mailCodes/${code}`) : null;
  const c = codeRef ? (await codeRef.get()).data() : null;
  if (!c || c.used || c.expires < Date.now()) {
    logger.warn('reply rejected: code', { from, code });
    // Answer only the user themselves (a used / expired code); anything else (spam, strangers) — silence.
    if (c && c.email === from) await reply(rejectionMail('code'));
    return;
  }
  const authResults = header(parsed, 'authentication-results').join('; ');
  if (!senderOk(from, c.email, authResults)) {
    // Not the user — no answer to a stranger beyond silence; just log it.
    logger.warn('reply rejected: sender', { from, code });
    return;
  }
  const text = (parsed.text || '').slice(0, 4000);
  const result = parseReply(text, c.item);
  if (result.kind === 'unknown') {
    await reply(rejectionMail('unknown'), code);
    return;
  }
  await db.runTransaction(async tx => {
    const fresh = await tx.get(codeRef);
    if (fresh.get('used')) throw new Error('code already used');
    tx.update(codeRef, { used: true, usedAt: Date.now() });
    tx.create(db.collection(`${APP}/users/${c.uid}/mailInbox`).doc(), {
      code, courseId: c.item.courseId, workplaceId: c.item.workplaceId, date: c.date,
      ...result, text, from, receivedAt: Date.now(), status: 'new', created: FieldValue.serverTimestamp(),
    });
  });
  await reply(confirmationMail(result, c.item, c.date));
  logger.info('reply recorded', { uid: c.uid, code, kind: result.kind });
}
