// Recording a parsed e-mail reply (reporting-hours) straight into the user's synced data — pure, no Firebase.
// Covered by functions/test/mailRecord.test.mjs.
//
// The app keeps each data key as one kv doc: apps/reporting-hours/users/{uid}/kv/<docId> = { v: JSON string, updated }.
// The server writes exactly like another device would: it changes `v` and bumps `updated`; the app's three-way merge
// (lib/merge.ts — reports by `id`, session marks by courseId+date, the minutes counter additively) brings it in.
//
// Mirrors the app (yanivmalka/Reporting-hours): buildReportDraft + leftoverMinutesFor (lib/reportForm.ts),
// addAccumulatedMinutes (lib/accumulated.ts), setSessionMark (lib/sessions.ts). Keep the two in step.

export const KV = {
  reports: 'reports~v1',
  sessions: 'sessions~v1',
  accumulated: 'accumulated~v2',
  workplaces: 'workplaces~v1',
  payBasis: 'pay-basis~v1',
  leftoverMode: 'leftover-mode~v1',
};

const ACADEMIC_HOUR = 45;

const rand6 = () => Math.random().toString(36).slice(2, 8);
const makeId = (now, prefix) => `${prefix}_${now.toString(36)}_${rand6()}`;

export function parseJSON(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const minutesOf = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Leftover minutes (not completing an academic hour) — only where the workplace pays per academic hour. */
export function leftoverMinutes(net, workplace, basis) {
  const b = workplace?.payBasis ?? (basis === 'regular' ? 'regular' : 'academic');
  return b === 'academic' ? Math.max(0, Math.round(net)) % ACADEMIC_HOUR : 0;
}

/**
 * The reply → the new values of the kv docs it changes.
 *   data:  { reports, sessions, accumulated, workplaces, payBasis, leftoverMode } — parsed values (missing = default)
 *   reply: { kind, start, end, breakMinutes, reason, courseId, courseName, workplaceId, date, text, receivedAt }
 * Returns { changes: { reports?, sessions?, accumulated? }, reportId?, skipped? } — skipped: already reported.
 */
export function recordReply(data, reply, now = Date.now()) {
  const reports = Array.isArray(data.reports) ? data.reports : [];
  if (reply.kind === 'canceled') {
    const marks = (Array.isArray(data.sessions) ? data.sessions : []).filter(
      m => !(m.courseId === reply.courseId && m.date === reply.date),
    );
    const reason = String(reply.reason || '').trim();
    marks.push({ courseId: reply.courseId, date: reply.date, status: 'canceled', ...(reason ? { reason } : {}), at: now });
    return { changes: { sessions: marks } };
  }

  // Already reported in the app meanwhile — no duplicate.
  if (reports.some(r => r.courseId === reply.courseId && r.date === reply.date)) return { changes: {}, skipped: true };

  const start = minutesOf(reply.start);
  const end = minutesOf(reply.end);
  const breakMinutes = Math.max(0, Math.round(Number(reply.breakMinutes) || 0));
  const net = start != null && end != null ? Math.max(0, end - start - breakMinutes) : 0;
  const workplace = (Array.isArray(data.workplaces) ? data.workplaces : []).find(w => w.id === reply.workplaceId);
  const leftover = leftoverMinutes(net, workplace, data.payBasis);
  const carried = data.leftoverMode === 'include' ? 0 : leftover;

  const reportId = makeId(now, 'wr');
  const report = {
    workplaceId: reply.workplaceId,
    date: reply.date,
    start: reply.start,
    end: reply.end,
    breaks: breakMinutes > 0 ? [{ id: makeId(now, 'br'), minutes: breakMinutes }] : [],
    carriedMinutes: carried,
    ...(reply.courseName ? { note: reply.courseName } : {}),
    courseId: reply.courseId,
    viaEmail: { text: reply.text, receivedAt: reply.receivedAt },
    id: reportId,
    createdAt: now,
  };
  const changes = { reports: [...reports, report] };

  if (carried > 0) {
    const acc = data.accumulated && typeof data.accumulated === 'object' ? data.accumulated : {};
    const byWorkplace = { ...(acc.byWorkplace ?? {}) };
    const e = byWorkplace[reply.workplaceId] ?? { minutes: 0, redeemedHours: 0 };
    byWorkplace[reply.workplaceId] = { ...e, minutes: (Number(e.minutes) || 0) + carried };
    changes.accumulated = { ...acc, byWorkplace };
  }
  return { changes, reportId };
}
