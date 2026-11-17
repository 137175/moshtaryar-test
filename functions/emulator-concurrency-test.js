// Emulator integration test: two simultaneous approvals for the same slot.
// Run only while Auth, Firestore, and Functions emulators are running.
// This script refuses to run unless the project ID is the isolated demo project.
const PROJECT_ID = 'demo-moshtaryar-emulator';
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(`Refusing unexpected project: ${process.env.GCLOUD_PROJECT}`);
}
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT_ID });
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';

const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
const API_KEY = 'fake-api-key-for-emulator';
const REGION = 'us-central1';
const FUNCTION_URL = `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}/approveBooking`;

async function makeUser(label) {
  // Create and sign in through the Auth Emulator REST API. This avoids
  // requiring a real service-account signing key in GitHub Actions.
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}@moshtaryar.test`, password: 'test-password-123', returnSecureToken: true })
  });
  const body = await response.json();
  if (!response.ok || !body.localId || !body.idToken) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return { uid: body.localId, idToken: body.idToken };
}

async function callApprove(idToken, bookingId) {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { bookingId } })
  });
  const body = await response.json();
  return { ok: response.ok && !!body.result, status: response.status, body };
}
function assert(condition, message) { if (!condition) throw new Error(`ASSERTION FAILED: ${message}`); }
async function callFunction(name, idToken, payload) {
  const response = await fetch(`http://127.0.0.1:5001/${PROJECT_ID}/${REGION}/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: payload })
  });
  const body = await response.json();
  return { ok: response.ok && !!body.result, status: response.status, body };
}

(async () => {
  const suffix = `${Date.now()}`;
  const vendorId = `emulator-vendor-${suffix}`;
  const manager = await makeUser(`manager-${suffix}`);
  const customerA = await makeUser(`customer-a-${suffix}`);
  const customerB = await makeUser(`customer-b-${suffix}`);
  const unrelatedManager = await makeUser(`unrelated-manager-${suffix}`);
  const date = '2030-05-20';
  const bookingA = `emulator-booking-a-${suffix}`;
  const bookingB = `emulator-booking-b-${suffix}`;
  const lockRef = db.doc(`bookingLocks/${vendorId}__${date}`);
  try {
    await db.doc(`users/${manager.uid}`).set({ uid: manager.uid, role: 'store_manager' });
    await db.doc(`users/${unrelatedManager.uid}`).set({ uid: unrelatedManager.uid, role: 'store_manager' });
    await db.doc(`vendors/${vendorId}`).set({
      ownerUid: manager.uid, managerUid: manager.uid, status: 'approved',
      services: [{ name: 'اصلاح مو', durationMinutes: 30 }]
    });
    const common = { vendorId, date, time: '10:00', service: 'اصلاح مو', status: 'در انتظار تأیید' };
    await db.doc(`bookings/${bookingA}`).set({ ...common, customerUid: customerA.uid });
    await db.doc(`bookings/${bookingB}`).set({ ...common, customerUid: customerB.uid });

    const results = await Promise.all([
      callApprove(manager.idToken, bookingA),
      callApprove(manager.idToken, bookingB)
    ]);
    const successes = results.filter(r => r.ok);
    const failures = results.filter(r => !r.ok);
    assert(successes.length === 1, `expected exactly one successful approval; got ${successes.length}; ${JSON.stringify(results)}`);
    assert(failures.length === 1, `expected exactly one rejected approval; got ${failures.length}`);

    const [a, b, lock] = await Promise.all([
      db.doc(`bookings/${bookingA}`).get(), db.doc(`bookings/${bookingB}`).get(), lockRef.get()
    ]);
    const approved = [a, b].filter(s => s.get('status') === 'تأیید شده');
    assert(approved.length === 1, `expected one approved booking in Firestore; got ${approved.length}`);
    assert(lock.exists, 'expected lock document to exist');
    const entries = lock.get('entries') || [];
    assert(entries.length === 1, `expected one lock entry; got ${entries.length}`);
    assert(entries[0].bookingId === approved[0].id, 'lock entry must match the approved booking');

    const approvedId = approved[0].id;
    const pendingId = approvedId === bookingA ? bookingB : bookingA;

    // A different customer must not cancel another customer's confirmed booking.
    const attackerToken = approvedId === bookingA ? customerB.idToken : customerA.idToken;
    const crossCustomerCancel = await callFunction('cancelBooking', attackerToken, { bookingId: approvedId });
    assert(!crossCustomerCancel.ok, 'a customer must not cancel another customer booking');
    const unchangedAfterAttack = await db.doc(`bookings/${approvedId}`).get();
    assert(unchangedAfterAttack.get('status') === 'تأیید شده', 'unauthorized cancellation must leave booking unchanged');

    // Customers and managers of unrelated stores must not approve/reject bookings.
    const customerApprove = await callApprove(customerA.idToken, pendingId);
    assert(!customerApprove.ok, 'a customer must not approve a booking');
    const unrelatedApprove = await callApprove(unrelatedManager.idToken, pendingId);
    assert(!unrelatedApprove.ok, 'an unrelated store manager must not approve this booking');
    const unrelatedReject = await callFunction('rejectBooking', unrelatedManager.idToken, { bookingId: pendingId });
    assert(!unrelatedReject.ok, 'an unrelated store manager must not reject this booking');
    const stillPending = await db.doc(`bookings/${pendingId}`).get();
    assert(stillPending.get('status') === 'در انتظار تأیید', 'unauthorized approve/reject attempts must leave booking pending');
    const cancelResponse = await fetch(`http://127.0.0.1:5001/${PROJECT_ID}/${REGION}/cancelBooking`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${manager.idToken}` },
      body: JSON.stringify({ data: { bookingId: approvedId } })
    });
    const cancelBody = await cancelResponse.json();
    assert(cancelResponse.ok && !!cancelBody.result, `manager cancellation failed: ${JSON.stringify(cancelBody)}`);
    const afterCancel = await lockRef.get();
    assert(!afterCancel.exists || (afterCancel.get('entries') || []).every(e => e.bookingId !== approvedId), 'cancelled booking must be removed from the lock');

    const remainingId = pendingId;
    const retry = await callApprove(manager.idToken, remainingId);
    assert(retry.ok, `the other pending booking should be approvable after cancellation: ${JSON.stringify(retry.body)}`);
    const finalLock = await lockRef.get();
    assert(finalLock.exists && (finalLock.get('entries') || []).length === 1, 'lock must contain exactly one entry after retry');
    console.log('PASS: concurrency lock, cancellation release, cross-customer cancellation denial, customer approval denial, unrelated-manager approve/reject denial, and retry after cancellation.');
  } finally {
    await Promise.all([
      db.doc(`bookings/${bookingA}`).delete().catch(() => {}),
      db.doc(`bookings/${bookingB}`).delete().catch(() => {}),
      lockRef.delete().catch(() => {}),
      db.doc(`vendors/${vendorId}`).delete().catch(() => {}),
      db.doc(`users/${manager.uid}`).delete().catch(() => {}),
      auth.deleteUser(manager.uid).catch(() => {}),
      auth.deleteUser(customerA.uid).catch(() => {}),
      auth.deleteUser(customerB.uid).catch(() => {}),
      auth.deleteUser(unrelatedManager.uid).catch(() => {}),
      db.doc(`users/${unrelatedManager.uid}`).delete().catch(() => {})
    ]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
