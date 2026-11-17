// Client-side Firestore Security Rules tests.
// These use the Firestore Emulator and authenticated client SDK contexts;
// Admin SDK seeding is used only inside withSecurityRulesDisabled.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp
} = require('firebase/firestore');

const PROJECT_ID = 'demo-moshtaryar-emulator';
const RULES_PATH = path.resolve(__dirname, '..', 'firestore.rules.candidate');
let env;

function client(uid) {
  return env.authenticatedContext(uid).firestore();
}
async function seed(callback) {
  return env.withSecurityRulesDisabled(async context => callback(context.firestore()));
}

test.before(async () => {
  if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID) {
    throw new Error(`Refusing unexpected project: ${process.env.GCLOUD_PROJECT}`);
  }
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8')
    }
  });
});

test.after(async () => {
  if (env) await env.cleanup();
});

test.beforeEach(async () => {
  await env.clearFirestore();
});

test('users: self-registration is customer-only and role escalation is denied', async () => {
  const alice = client('alice');
  await assertSucceeds(setDoc(doc(alice, 'users/alice'), {
    uid: 'alice', email: 'alice@example.test', role: 'customer'
  }));
  await assertFails(setDoc(doc(alice, 'users/alice'), {
    uid: 'alice', email: 'alice@example.test', role: 'super_admin'
  }));
  await assertFails(updateDoc(doc(alice, 'users/alice'), {
    role: 'super_admin', updatedAt: serverTimestamp()
  }));
  await assertFails(getDoc(doc(client('mallory'), 'users/alice')));
});

test('vendors: customers can read approved stores but not pending stores', async () => {
  await seed(async db => {
    await setDoc(doc(db, 'vendors/approved-vendor'), {
      id: 'approved-vendor', ownerUid: 'owner', managerUid: 'manager', status: 'approved'
    });
    await setDoc(doc(db, 'vendors/pending-vendor'), {
      id: 'pending-vendor', ownerUid: 'owner', managerUid: null, status: 'pending'
    });
  });
  const customer = client('customer');
  await assertSucceeds(getDoc(doc(customer, 'vendors/approved-vendor')));
  await assertFails(getDoc(doc(customer, 'vendors/pending-vendor')));
});

test('vendors: owner can create a pending store and edit profile only', async () => {
  const owner = client('owner');
  await assertSucceeds(setDoc(doc(owner, 'vendors/owner-store'), {
    id: 'owner-store', ownerUid: 'owner', managerUid: null, status: 'pending',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(owner, 'vendors/owner-store'), {
    name: 'نام فروشگاه', updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(owner, 'vendors/owner-store'), {
    managerUid: 'attacker', updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(owner, 'vendors/forged-approved-store'), {
    id: 'forged-approved-store', ownerUid: 'owner', managerUid: null, status: 'approved',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
});

test('bookings: customer can create own pending request; status and lock stay server-only', async () => {
  await seed(async db => {
    await setDoc(doc(db, 'vendors/vendor-a'), {
      id: 'vendor-a', ownerUid: 'manager-a', managerUid: 'manager-a', status: 'approved'
    });
  });
  const alice = client('alice');
  const booking = doc(alice, 'bookings/booking-a');
  await assertSucceeds(setDoc(booking, {
    id: 'booking-a', customerUid: 'alice', vendorId: 'vendor-a',
    name: 'مشتری', phone: '09120000000', service: 'اصلاح مو',
    date: '2030-05-20', time: '10:00', status: 'در انتظار تأیید',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertSucceeds(getDoc(booking));
  await assertFails(getDoc(doc(client('bob'), 'bookings/booking-a')));
  await assertFails(updateDoc(booking, {
    status: 'تأیید شده', updatedAt: serverTimestamp()
  }));
  await assertFails(deleteDoc(booking));
  await assertFails(getDoc(doc(alice, 'bookingLocks/vendor-a__2030-05-20')));
  await assertFails(setDoc(doc(alice, 'bookingLocks/vendor-a__2030-05-20'), {
    vendorId: 'vendor-a', date: '2030-05-20', bookingIds: ['booking-a']
  }));
});

console.log('Firestore rules test suite loaded.');
