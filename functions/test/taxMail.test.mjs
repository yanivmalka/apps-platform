import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentName, nextQuota, ownTaxPath, taxMail, validEmail, validYear } from '../src/taxMail.mjs';

const w = { name: 'גור', payrollEmail: 'pay@college.ac.il', ccEmails: ['boss@college.ac.il', 'PAY@college.ac.il', 'bad'], employeeNumber: '123' };
const user = { name: 'יניב מלכא', email: 'yaniv@example.com' };

test('mail: recipients from the workplace, user in Cc and Reply-To, no duplicates', () => {
  const m = taxMail(w, '2027', user);
  assert.equal(m.to, 'pay@college.ac.il');
  assert.deepEqual(m.cc, ['boss@college.ac.il', 'yaniv@example.com']);
  assert.equal(m.replyTo, 'yaniv@example.com');
  assert.equal(m.fromName, 'יניב מלכא');
  assert.equal(m.subject, 'טופס תיאום מס 2027 — יניב מלכא');
  assert.match(m.text, /לשנת 2027 \(מספר עובד 123\)/);
});

test('mail: no payroll address / no user address', () => {
  assert.deepEqual(taxMail({ ...w, payrollEmail: '' }, '2027', user), { error: 'noRecipient' });
  assert.deepEqual(taxMail({ ...w, payrollEmail: 'a@b.c, d@e.f' }, '2027', user), { error: 'noRecipient' });
  assert.deepEqual(taxMail(w, '2027', { name: 'x', email: null }), { error: 'noUserEmail' });
});

test('mail: user already among the recipients is not added twice', () => {
  const m = taxMail({ payrollEmail: 'yaniv@example.com' }, '2026', user);
  assert.deepEqual(m.cc, []);
});

test('validation helpers', () => {
  assert.ok(validEmail('a@b.co'));
  assert.ok(!validEmail('a@b'));
  assert.ok(!validEmail('Name <a@b.co>'));
  assert.ok(validYear('2027'));
  assert.ok(!validYear('27'));
  assert.ok(!validYear(2027));
  assert.ok(ownTaxPath('apps/reporting-hours/users/u1/files/tax/w1-2027.pdf', 'reporting-hours', 'u1'));
  assert.ok(!ownTaxPath('apps/reporting-hours/users/u2/files/tax/w1-2027.pdf', 'reporting-hours', 'u1'));
  assert.ok(!ownTaxPath('apps/reporting-hours/users/u1/files/tax/../../u2/x.pdf', 'reporting-hours', 'u1'));
  assert.equal(attachmentName('C:\\docs\\טופס.pdf', '2027', 'pdf'), 'טופס.pdf');
  assert.equal(attachmentName('', '2027', 'jpg'), 'tax-coordination-2027.jpg');
});

test('daily quota', () => {
  assert.deepEqual(nextQuota(undefined, '2026-11-18'), { ok: true, value: { date: '2026-11-18', count: 1 } });
  assert.deepEqual(nextQuota({ date: '2026-11-17', count: 10 }, '2026-11-18'), { ok: true, value: { date: '2026-11-18', count: 1 } });
  assert.deepEqual(nextQuota({ date: '2026-11-18', count: 10 }, '2026-11-18'), { ok: false });
});

test('mail: grantee copy and signature with phone', () => {
  const m = taxMail(w, '2027', { ...user, phone: '050-1234567' }, ['helper@example.com']);
  assert.deepEqual(m.cc, ['boss@college.ac.il', 'yaniv@example.com', 'helper@example.com']);
  assert.match(m.text, /בברכה,\nיניב מלכא\nמספר עובד 123\n050-1234567 · yaniv@example.com/);
});
