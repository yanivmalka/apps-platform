// Cloud Storage rules tests. Run with the emulators:  npm run test:rules
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-apps-platform',
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(() => env.cleanup());

const as = (uid, provider = 'google.com') => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).storage();
const F = uid => `apps/reporting-hours/users/${uid}/files/tax/w1-2027.pdf`;
const pdf = new Uint8Array([37, 80, 68, 70]);

test('own files: the owner uploads a PDF, reads and deletes it; nobody else can', async () => {
  await assertSucceeds(uploadBytes(ref(as('u1'), F('u1')), pdf, { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ref(as('u1'), F('u1'))));
  await assertFails(getBytes(ref(as('u2'), F('u1'))));
  await assertFails(uploadBytes(ref(as('u2'), F('u1')), pdf, { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(as('a1', 'anonymous'), F('a1')), pdf, { contentType: 'application/pdf' }));
  await assertFails(deleteObject(ref(as('u2'), F('u1'))));
  await assertSucceeds(deleteObject(ref(as('u1'), F('u1'))));
});

test('only PDF or images, up to 10 MB', async () => {
  await assertSucceeds(uploadBytes(ref(as('u1'), F('u1').replace('.pdf', '.jpg')), pdf, { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(as('u1'), F('u1').replace('.pdf', '.exe')), pdf, { contentType: 'application/octet-stream' }));
  await assertFails(uploadBytes(ref(as('u1'), F('u1')), new Uint8Array(10 * 1024 * 1024 + 1), { contentType: 'application/pdf' }));
});

test('everything outside users/<uid>/files is closed', async () => {
  await assertFails(uploadBytes(ref(as('u1'), 'apps/reporting-hours/public/x.pdf'), pdf, { contentType: 'application/pdf' }));
  await assertFails(getBytes(ref(as('u1'), 'other/x.pdf')));
});
