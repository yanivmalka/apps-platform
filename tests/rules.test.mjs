// Security-rules tests. Run with the Firestore emulator:  npm run test:rules
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, increment, serverTimestamp } from 'firebase/firestore';

let env;
const A = 'apps/omer';
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-apps-platform', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await setDoc(doc(db, 'admins/boss'), { apps: ['*'] });
    await setDoc(doc(db, 'admins/rhythm-only'), { apps: ['rhythm'] });
    await setDoc(doc(db, `${A}/plans/p1`), { name: 'לילה אחד', price: 36, active: true });
    await setDoc(doc(db, `${A}/plans/off`), { name: 'ישנה', price: 10, active: false });
    await setDoc(doc(db, `${A}/config/inventory`), { minPrice: 18 });
    await setDoc(doc(db, 'users/cust'), { name: 'לקוח', phone: '0501234567' });
    await setDoc(doc(db, `${A}/orders/o1`), { uid: 'cust', status: 'pending', price: 36, name: 'פלוני', planId: 'p1' });
    await setDoc(doc(db, `${A}/orders/o2`), { uid: 'other', status: 'pending', price: 36, name: 'אלמוני', planId: 'p1' });
  });
});
const as = (uid, provider = 'google.com') => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
const anon = uid => as(uid, 'anonymous');
const order = (uid, extra = {}) => ({ uid, status: 'pending', price: 36, name: 'יוסף בן רחל', planId: 'p1', ...extra });

test('public catalogue is readable by anyone, writable only by the app admin', async () => {
  const guest = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(guest, `${A}/plans/p1`)));
  await assertSucceeds(getDoc(doc(guest, `${A}/slots/5787-1`)));
  await assertFails(setDoc(doc(as('cust'), `${A}/plans/x`), { price: 1 }));
  await assertFails(setDoc(doc(as('rhythm-only'), `${A}/plans/x`), { price: 1 }));
  await assertSucceeds(setDoc(doc(as('boss'), `${A}/plans/x`), { price: 1 }));
  await assertSucceeds(setDoc(doc(as('boss'), `${A}/slots/5787-1`), { items: [] }));
});

test('registration: own profile only, name and phone required, no anonymous', async () => {
  await assertSucceeds(setDoc(doc(as('new'), 'users/new'), { name: 'משה', phone: '0521234567', created: 1 }));
  await assertFails(setDoc(doc(as('new'), 'users/new'), { name: 'משה' }));
  await assertFails(setDoc(doc(as('new'), 'users/new'), { name: 'משה', phone: '0521234567', role: 'admin' }));
  await assertFails(setDoc(doc(as('new'), 'users/cust'), { name: 'משה', phone: '0521234567' }));
  await assertFails(setDoc(doc(anon('a1'), 'users/a1'), { name: 'משה', phone: '0521234567' }));
  await assertFails(getDoc(doc(as('new'), 'users/cust')));
  await assertSucceeds(getDoc(doc(as('boss'), 'users/cust')));
});

test('orders: only registered users, own uid, pending, real plan price', async () => {
  await assertSucceeds(setDoc(doc(as('cust'), `${A}/orders/n1`), order('cust')));
  await assertFails(setDoc(doc(as('unreg'), `${A}/orders/n2`), order('unreg')));               // not registered
  await assertFails(setDoc(doc(as('cust'), `${A}/orders/n3`), order('other')));                // someone else's uid
  await assertFails(setDoc(doc(as('cust'), `${A}/orders/n4`), order('cust', { status: 'active' })));
  await assertFails(setDoc(doc(as('cust'), `${A}/orders/n5`), order('cust', { price: 1 })));   // wrong price
  await assertFails(setDoc(doc(as('cust'), `${A}/orders/n6`), order('cust', { planId: 'off', price: 10 }))); // stopped plan
  await assertFails(setDoc(doc(as('cust'), `${A}/orders/n7`), order('cust', { sim: true })));
  await assertSucceeds(setDoc(doc(as('cust'), `${A}/orders/n8`), order('cust', { planId: 'custom', price: 18 })));
  await assertFails(setDoc(doc(as('cust'), `${A}/orders/n9`), order('cust', { planId: 'custom', price: 5 })));
});

test('orders: customers read only their own and may only cancel a pending one', async () => {
  const c = as('cust');
  await assertSucceeds(getDoc(doc(c, `${A}/orders/o1`)));
  await assertFails(getDoc(doc(c, `${A}/orders/o2`)));
  await assertSucceeds(getDocs(query(collection(c, `${A}/orders`), where('uid', '==', 'cust'))));
  await assertFails(getDocs(collection(c, `${A}/orders`)));
  await assertFails(updateDoc(doc(c, `${A}/orders/o1`), { status: 'active' }));
  await assertFails(updateDoc(doc(c, `${A}/orders/o1`), { status: 'cancelled', price: 1 }));
  await assertSucceeds(updateDoc(doc(c, `${A}/orders/o1`), { status: 'cancelled' }));
  await assertSucceeds(updateDoc(doc(as('boss'), `${A}/orders/o2`), { status: 'active' }));
  await assertSucceeds(getDocs(collection(as('boss'), `${A}/orders`)));
});

test('stats: any app install adds counters, only known fields', async () => {
  const s = `${A}/stats/5787-1-0`;
  await assertSucceeds(setDoc(doc(anon('dev1'), s), { season: 5787, night: 1, shown: { o1: increment(1) }, updated: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), s), { shown: { o1: increment(1) }, updated: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(anon('dev1'), s), { hack: 1, updated: serverTimestamp() }, { merge: true }));
  await assertFails(setDoc(doc(anon('dev1'), s), { shown: { o1: increment(1) }, updated: 5 }, { merge: true }));
});

test('admins list is not writable from clients', async () => {
  await assertFails(setDoc(doc(as('cust'), 'admins/cust'), { apps: ['*'] }));
  await assertFails(setDoc(doc(as('boss'), 'admins/cust'), { apps: ['*'] }));
  await assertSucceeds(getDoc(doc(as('cust'), 'admins/cust')));
});

test('per-user app data: only the owner (real sign-in) reads and writes it', async () => {
  const R = 'apps/reporting-hours/users';
  await assertSucceeds(setDoc(doc(as('lect'), `${R}/lect/kv/reports`), { v: '[]', updated: 1 }));
  await assertSucceeds(getDoc(doc(as('lect'), `${R}/lect/kv/reports`)));
  await assertSucceeds(getDocs(collection(as('lect'), `${R}/lect/kv`)));
  await assertFails(getDoc(doc(as('other'), `${R}/lect/kv/reports`)));
  await assertFails(setDoc(doc(as('other'), `${R}/lect/kv/reports`), { v: '[]' }));
  await assertFails(getDoc(doc(as('boss'), `${R}/lect/kv/reports`)));                         // admins too
  await assertFails(setDoc(doc(anon('lect'), `${R}/lect/kv/reports`), { v: '[]' }));           // anonymous
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `${R}/lect/kv/reports`)));
});
