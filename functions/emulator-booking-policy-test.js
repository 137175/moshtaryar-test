// Emulator policy tests for booking approval, authorization, and lock lifecycle.
// This script is safe only against the isolated demo project and refuses other targets.
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
const { getFirestore } = require('firebase-admin/firestore');
if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
const API_KEY = 'fake-api-key-for-emulator';
const BASE = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
const PENDING = 'در انتظار تأیید';
const APPROVED = 'تأیید شده';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}
async function makeUser(label) {
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${label}@moshtaryar.test`, password: 'test-password-123', returnSecureToken: true })
  });
  const body = await response.json();
  if (!response.ok || !body.localId || !body.idToken) throw new Error(`Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return { uid: body.localId, idToken: body.idToken };
}
async function call(name, token, data) {
  const response = await fetch(`${BASE}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data })
  });
  const body = await response.json();
  return { ok: response.ok && !!body.result, status: response.status, body };
}
function lockRef(vendorId, date) { return db.doc(`bookingLocks/${vendorId}__${date}`); }

(async () => {
  const suffix = String(Date.now());
  const managerA = await makeUser(`policy-manager-a-${suffix}`);
  const managerB = await makeUser(`policy-manager-b-${suffix}`);
  const customer = await makeUser(`policy-customer-${suffix}`);
  const vendorA = `policy-vendor-a-${suffix}`;
  const vendorB = `policy-vendor-b-${suffix}`;
  const bookingIds = [];
  const dates = ['2030-06-01', '2030-06-02', '2030-06-03', '2030-06-04'];
  const lockRefs = [];
  async function createBooking(vendorId, date, time, service, customerUid, label) {
    const id = `policy-${label}-${suffix}`;
    bookingIds.push(id);
    await db.doc(`bookings/${id}`).set({
      id, vendorId, date, time, service, customerUid,
      status: PENDING, name: 'Emulator Test', phone: '0000000000'
    });
    return id;
  }
  try {
    await Promise.all([
      db.doc(`users/${managerA.uid}`).set({ uid: managerA.uid, role: 'store_manager' }),
      db.doc(`users/${managerB.uid}`).set({ uid: managerB.uid, role: 'store_manager' }),
      db.doc(`users/${customer.uid}`).set({ uid: customer.uid, role: 'customer' }),
      db.doc(`vendors/${vendorA}`).set({
        ownerUid: managerA.uid, managerUid: managerA.uid, status: 'approved',
        services: [{ name: '۳۰ دقیقه', durationMinutes: 30 }, { name: '۶۰ دقیقه', durationMinutes: 60 }]
      }),
      db.doc(`vendors/${vendorB}`).set({
        ownerUid: managerB.uid, managerUid: managerB.uid, status: 'approved',
        services: [{ name: '۳۰ دقیقه', durationMinutes: 30 }]
      })
    ]);

    // Different durations: 10:00-11:00 conflicts with 10:30-11:00.
    const longId = await createBooking(vendorA, dates[0], '10:00', '۶۰ دقیقه', customer.uid, 'long');
    const overlapId = await createBooking(vendorA, dates[0], '10:30', '۳۰ دقیقه', customer.uid, 'overlap');
    lockRefs.push(lockRef(vendorA, dates[0]));
    const first = await call('approveBooking', managerA.idToken, { bookingId: longId });
    const second = await call('approveBooking', managerA.idToken, { bookingId: overlapId });
    assert(first.ok, `first long booking should approve: ${JSON.stringify(first.body)}`);
    assert(!second.ok, 'overlapping booking with a different duration must be rejected');

    // Adjacent slots: 11:00-11:30 and 11:30-12:00 do not overlap.
    const adjacentA = await createBooking(vendorA, dates[1], '11:00', '۳۰ دقیقه', customer.uid, 'adjacent-a');
    const adjacentB = await createBooking(vendorA, dates[1], '11:30', '۳۰ دقیقه', customer.uid, 'adjacent-b');
    lockRefs.push(lockRef(vendorA, dates[1]));
    const adjacentResults = await Promise.all([
      call('approveBooking', managerA.idToken, { bookingId: adjacentA }),
      call('approveBooking', managerA.idToken, { bookingId: adjacentB })
    ]);
    assert(adjacentResults.every(r => r.ok), `adjacent bookings should both approve: ${JSON.stringify(adjacentResults)}`);
    const adjacentLock = await lockRef(vendorA, dates[1]).get();
    assert(adjacentLock.exists && adjacentLock.get('entries').length === 2, 'adjacent lock should contain both bookings');

    // Rejecting a pending booking must not create a reservation lock.
    const rejectedId = await createBooking(vendorA, dates[2], '12:00', '۳۰ دقیقه', customer.uid, 'rejected');
    lockRefs.push(lockRef(vendorA, dates[2]));
    const rejected = await call('rejectBooking', managerA.idToken, { bookingId: rejectedId });
    assert(rejected.ok, `manager should reject pending booking: ${JSON.stringify(rejected.body)}`);
    const rejectedLock = await lockRef(vendorA, dates[2]).get();
    assert(!rejectedLock.exists, 'rejected pending booking must not create a lock');

    // A customer cannot approve, and a manager cannot approve another vendor's booking.
    const customerAttemptId = await createBooking(vendorA, dates[3], '13:00', '۳۰ دقیقه', customer.uid, 'customer-forbidden');
    const foreignManagerAttemptId = await createBooking(vendorA, dates[3], '14:00', '۳۰ دقیقه', customer.uid, 'foreign-manager');
    lockRefs.push(lockRef(vendorA, dates[3]));
    const customerAttempt = await call('approveBooking', customer.idToken, { bookingId: customerAttemptId });
    const foreignManagerAttempt = await call('approveBooking', managerB.idToken, { bookingId: foreignManagerAttemptId });
    assert(!customerAttempt.ok, 'customer must not approve a booking');
    assert(!foreignManagerAttempt.ok, 'manager of another vendor must not approve this vendor booking');
    const forbiddenStates = await Promise.all([
      db.doc(`bookings/${customerAttemptId}`).get(),
      db.doc(`bookings/${foreignManagerAttemptId}`).get()
    ]);
    assert(forbiddenStates.every(s => s.get('status') === PENDING), 'unauthorized attempts must leave booking status pending');

    console.log('PASS: duration-aware overlap rejected; adjacent slots both approved; rejection created no lock; customer and foreign-manager approvals denied.');
  } finally {
    await Promise.all([
      ...bookingIds.map(id => db.doc(`bookings/${id}`).delete().catch(() => {})),
      ...lockRefs.map(ref => ref.delete().catch(() => {})),
      db.doc(`vendors/${vendorA}`).delete().catch(() => {}),
      db.doc(`vendors/${vendorB}`).delete().catch(() => {}),
      db.doc(`users/${managerA.uid}`).delete().catch(() => {}),
      db.doc(`users/${managerB.uid}`).delete().catch(() => {}),
      db.doc(`users/${customer.uid}`).delete().catch(() => {}),
      auth.deleteUser(managerA.uid).catch(() => {}),
      auth.deleteUser(managerB.uid).catch(() => {}),
      auth.deleteUser(customer.uid).catch(() => {})
    ]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
