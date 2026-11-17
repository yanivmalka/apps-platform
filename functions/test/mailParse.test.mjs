import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeFromAddresses, makeCode, ownText, parseReply, replyAddress, senderOk } from '../src/mailParse.mjs';

const planned = { start: '08:30', end: '11:40', breakMinutes: 10 };

test('code in the reply address', () => {
  assert.equal(replyAddress('abc123xyz9'), 'reportinghours.app+abc123xyz9@gmail.com');
  assert.equal(codeFromAddresses(['someone@x.com', 'ReportingHours.App+AbC123xyz9@gmail.com']), 'abc123xyz9');
  assert.equal(codeFromAddresses(['reportinghours.app@gmail.com']), null);
  assert.equal(codeFromAddresses(['evil+abc123xyz9@gmail.com']), null);
  const c = makeCode(() => 0.5);
  assert.equal(c.length, 10);
});

test('sender must match and pass DKIM or SPF', () => {
  assert.ok(senderOk('Yaniv@Gmail.com', 'yaniv@gmail.com', 'mx.google.com; dkim=pass header.i=@gmail.com; spf=pass'));
  assert.ok(!senderOk('other@gmail.com', 'yaniv@gmail.com', 'dkim=pass'));
  assert.ok(!senderOk('yaniv@gmail.com', 'yaniv@gmail.com', 'dkim=fail; spf=softfail'));
  assert.ok(!senderOk('yaniv@gmail.com', 'yaniv@gmail.com', ''));
});

test('own text stops at the quoted original', () => {
  const t = 'כן\n\n‏בתאריך יום ג׳, 17 בנוב׳ 2026 ב-21:00 מאת דיווח שעות <reportinghours.app+abc@gmail.com>:\n> המפגש של היום';
  assert.equal(ownText(t), 'כן');
  assert.equal(ownText('8:30-11:45\nOn Tue, Nov 17 wrote:\n> x'), '8:30-11:45');
});

test('replies: held, times, canceled, unknown', () => {
  assert.deepEqual(parseReply('כן', planned), { kind: 'held', start: '08:30', end: '11:40', breakMinutes: 10 });
  assert.deepEqual(parseReply('התקיים, תודה', planned), { kind: 'held', start: '08:30', end: '11:40', breakMinutes: 10 });
  assert.deepEqual(parseReply('8:30-11:45 הפסקה 15', planned), { kind: 'times', start: '08:30', end: '11:45', breakMinutes: 15 });
  assert.deepEqual(parseReply('9.00 – 12.15 בלי הפסקה', planned), { kind: 'times', start: '09:00', end: '12:15', breakMinutes: 0 });
  assert.deepEqual(parseReply('8:30 עד 11:00', planned), { kind: 'times', start: '08:30', end: '11:00', breakMinutes: 10 });
  assert.deepEqual(parseReply('בוטל מחלה', planned), { kind: 'canceled', reason: 'מחלה' });
  assert.deepEqual(parseReply('לא התקיים - שביתה', planned), { kind: 'canceled', reason: 'שביתה' });
  assert.equal(parseReply('מה נשמע?', planned).kind, 'unknown');
  assert.equal(parseReply('12:00-08:00', planned).kind, 'unknown');
  assert.equal(parseReply('25:00-26:00', planned).kind, 'unknown');
});
