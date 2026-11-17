import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftoverMinutes, parseJSON, recordReply } from '../src/mailRecord.mjs';

const reply = {
  kind: 'times', start: '09:00', end: '16:00', breakMinutes: 0,
  courseId: 'c1', courseName: 'תכנון', workplaceId: 'w1', date: '2026-11-17', text: '09:00-16:00', receivedAt: 5,
};
const academic = [{ id: 'w1', name: 'גור', payBasis: 'academic' }];

test('times → a report with the e-mail text, leftover minutes to the counter', () => {
  const { changes, reportId } = recordReply({ reports: [{ id: 'old', courseId: 'c2', date: '2026-11-17' }], workplaces: academic }, reply, 100);
  assert.equal(changes.reports.length, 2);
  const r = changes.reports[1];
  assert.equal(r.id, reportId);
  assert.deepEqual(
    { ...r, id: undefined },
    { workplaceId: 'w1', date: '2026-11-17', start: '09:00', end: '16:00', breaks: [], carriedMinutes: 15, note: 'תכנון',
      courseId: 'c1', viaEmail: { text: '09:00-16:00', receivedAt: 5 }, id: undefined, createdAt: 100 },
  ); // 420 min = 9 academic hours + 15
  assert.deepEqual(changes.accumulated, { byWorkplace: { w1: { minutes: 15, redeemedHours: 0 } } });
});

test('break, existing counter, include mode, regular basis', () => {
  const acc = { byWorkplace: { w1: { minutes: 30, redeemedHours: 2 } } };
  const a = recordReply({ workplaces: academic, accumulated: acc }, { ...reply, breakMinutes: 15 }, 1);
  assert.equal(a.changes.reports[0].breaks[0].minutes, 15);
  assert.equal(a.changes.reports[0].carriedMinutes, 0); // 405 = 9 × 45
  assert.equal(a.changes.accumulated, undefined);
  const b = recordReply({ workplaces: academic, accumulated: acc }, { ...reply, end: '16:10' }, 1);
  assert.deepEqual(b.changes.accumulated.byWorkplace.w1, { minutes: 55, redeemedHours: 2 });
  const c = recordReply({ workplaces: academic, leftoverMode: 'include' }, { ...reply, end: '16:10' }, 1);
  assert.equal(c.changes.reports[0].carriedMinutes, 0);
  assert.equal(leftoverMinutes(430, { payBasis: 'regular' }, 'academic'), 0);
  assert.equal(leftoverMinutes(430, {}, 'regular'), 0);
  assert.equal(leftoverMinutes(430, {}, undefined), 25);
});

test('already reported → nothing written', () => {
  const r = recordReply({ reports: [{ id: 'x', courseId: 'c1', date: '2026-11-17' }] }, reply, 1);
  assert.deepEqual(r, { changes: {}, skipped: true });
});

test('canceled → session mark replaces an earlier one', () => {
  const sessions = [{ courseId: 'c1', date: '2026-11-17', status: 'held', at: 1 }, { courseId: 'c1', date: '2026-11-10', status: 'canceled', at: 1 }];
  const { changes } = recordReply({ sessions }, { ...reply, kind: 'canceled', reason: 'מחלה' }, 9);
  assert.deepEqual(changes.sessions, [
    { courseId: 'c1', date: '2026-11-10', status: 'canceled', at: 1 },
    { courseId: 'c1', date: '2026-11-17', status: 'canceled', reason: 'מחלה', at: 9 },
  ]);
  assert.equal(changes.reports, undefined);
});

test('parseJSON', () => {
  assert.deepEqual(parseJSON('[1]', []), [1]);
  assert.deepEqual(parseJSON('{bad', []), []);
  assert.equal(parseJSON(undefined, 'd'), 'd');
});
