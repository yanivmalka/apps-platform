// Cloud Functions for the apps platform. First: reporting by e-mail for reporting-hours
// (spec: yanivmalka/Reporting-hours docs/fixes-spec-2026-11-17.md §8).
//
// Mailbox reportinghours.app@gmail.com, App Password in the secret GMAIL_APP_PASSWORD.
//   mailSend  (every 15 min) — for each user who enabled it: after their send time, one mail per session of
//             today that is still unreported, with a one-time code in the Reply-To (reportinghours.app+<code>@…).
//   mailPoll  (every 5 min)  — reads new mail over IMAP; a reply is accepted only with a valid unused code, from
//             the user's address, with Gmail's DKIM/SPF pass. The reply is recorded right away, in one transaction,
//             in the user's synced data (kv: the report + minutes counter, or the session mark — mailRecord.mjs),
//             like another device would; every device and every grantee sees it on the next sync. A copy stays
//             in mailInbox (status 'recorded'). The sender gets a confirmation.
//
// Data (Firestore):
//   apps/reporting-hours/users/{uid}/mail/plan     ← written by the app: { enabled, email, sendTime, days: {date: [item]} }
//   apps/reporting-hours/users/{uid}/mail/sent     ← { sent: { "<courseId>|<date>": code } }
//   apps/reporting-hours/users/{uid}/mailInbox/{id} ← record of each accepted reply (status 'recorded', reportId)
//   apps/reporting-hours/users/{uid}/kv/…          ← the app's synced data; the reply is written here
//   apps/reporting-hours/mailCodes/{code}          ← server only (no client rule matches)
//
//   taxSend   (callable) — sends the user's tax-coordination form (Cloud Storage) as an attachment to the payroll
//             address saved for that workplace, Cc the user, Reply-To the user (spec §3). Recipients come only from
//             the saved workplace. Daily limit per user in apps/reporting-hours/taxQuota/{uid} (server only).
//             The app marks the year "sent" after a successful call.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
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
import { KV, parseJSON, recordReply } from './mailRecord.mjs';
import { attachmentName, nextQuota, ownTaxPath, taxMail, validYear } from './taxMail.mjs';

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
  const receivedAt = Date.now();
  await db.runTransaction(async tx => {
    const fresh = await tx.get(codeRef);
    if (fresh.get('used')) throw new Error('code already used');
    // The user's synced data (reads first — a transaction writes only after all its reads).
    const kvRef = id => db.doc(`${APP}/users/${c.uid}/kv/${id}`);
    const names = ['reports', 'sessions', 'accumulated', 'workplaces', 'payBasis', 'leftoverMode'];
    const snaps = await Promise.all(names.map(n => tx.get(kvRef(KV[n]))));
    const data = Object.fromEntries(names.map((n, i) => [n, parseJSON(snaps[i].get('v'), undefined)]));
    const { changes, reportId, skipped } = recordReply(data, {
      ...result, courseId: c.item.courseId, courseName: c.item.courseName, workplaceId: c.item.workplaceId,
      date: c.date, text, receivedAt,
    }, receivedAt);
    for (const [name, value] of Object.entries(changes)) {
      tx.set(kvRef(KV[name]), { v: JSON.stringify(value), updated: receivedAt });
    }
    tx.update(codeRef, { used: true, usedAt: receivedAt });
    tx.create(db.collection(`${APP}/users/${c.uid}/mailInbox`).doc(), {
      code, courseId: c.item.courseId, workplaceId: c.item.workplaceId, date: c.date,
      ...result, text, from, receivedAt, status: skipped ? 'skipped' : 'recorded',
      ...(reportId ? { reportId } : {}), created: FieldValue.serverTimestamp(),
    });
  });
  await reply(confirmationMail(result, c.item, c.date));
  logger.info('reply recorded', { uid: c.uid, code, kind: result.kind });
}

const BUCKET = 'malka-apps.firebasestorage.app';
const TAX_FILE_MAX = 10 * 1024 * 1024;

export const taxSend = onCall(
  { secrets: [GMAIL_APP_PASSWORD], timeoutSeconds: 60, memory: '512MiB' },
  async request => {
    const auth = request.auth;
    if (!auth || auth.token?.firebase?.sign_in_provider === 'anonymous') {
      throw new HttpsError('unauthenticated', 'signedOut');
    }
    const uid = auth.uid;
    const { workplaceId, year } = request.data ?? {};
    if (typeof workplaceId !== 'string' || !workplaceId || workplaceId.length > 100 || !validYear(year)) {
      throw new HttpsError('invalid-argument', 'bad');
    }
    // The workplace and the file — from the user's own synced data only.
    const kv = await db.doc(`${APP}/users/${uid}/kv/${KV.workplaces}`).get();
    const list = parseJSON(kv.get('v'), []);
    const w = (Array.isArray(list) ? list : []).find(x => x?.id === workplaceId);
    if (!w) throw new HttpsError('not-found', 'workplace');
    const file = w.taxFiles?.[year];
    if (!file || !ownTaxPath(file.path, 'reporting-hours', uid)) throw new HttpsError('not-found', 'file');
    const email = auth.token.email_verified === false ? '' : auth.token.email;
    const m = taxMail(w, year, { name: auth.token.name, email });
    if (m.error) throw new HttpsError('failed-precondition', m.error);

    const obj = getStorage().bucket(BUCKET).file(file.path);
    const [exists] = await obj.exists();
    if (!exists) throw new HttpsError('not-found', 'file');
    const [meta] = await obj.getMetadata();
    if (Number(meta.size) > TAX_FILE_MAX) throw new HttpsError('failed-precondition', 'tooBig');
    const [content] = await obj.download();

    const quotaRef = db.doc(`${APP}/taxQuota/${uid}`);
    const { date } = nowLocal();
    await db.runTransaction(async tx => {
      const q = nextQuota((await tx.get(quotaRef)).data(), date);
      if (!q.ok) throw new HttpsError('resource-exhausted', 'quota');
      tx.set(quotaRef, q.value);
    });

    const ext = /\.([a-z0-9]{2,5})$/i.exec(file.path)?.[1] ?? 'pdf';
    try {
      await transport().sendMail({
        from: { name: m.fromName, address: MAILBOX },
        to: m.to, cc: m.cc, replyTo: m.replyTo,
        subject: m.subject, text: m.text,
        attachments: [{ filename: attachmentName(file.name, year, ext), content, contentType: file.contentType || meta.contentType }],
      });
    } catch (e) {
      logger.error('tax send failed', { uid, workplaceId, year, error: String(e) });
      throw new HttpsError('unavailable', 'send');
    }
    await db.collection(`${APP}/users/${uid}/taxSends`).add({
      workplaceId, year, to: m.to, cc: m.cc, path: file.path, sentAt: Date.now(), created: FieldValue.serverTimestamp(),
    });
    logger.info('tax form sent', { uid, workplaceId, year });
    return { ok: true, to: m.to, cc: m.cc, date };
  },
);
