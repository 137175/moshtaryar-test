const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { validDate, toMinutes, overlaps, serviceDuration, isAdminRole } = require('./domain');

initializeApp();
const db = getFirestore();
const ACTIVE_CONFIRMED = new Set(['تأیید شده', 'تایید شده', 'approved', 'confirmed']);
const PENDING = 'در انتظار تأیید';
const APPROVED = 'تأیید شده';
function fail(code, message) { throw new HttpsError(code, message); }

async function authorizeManager(uid, vendorId) {
  const [profileSnap, vendorSnap] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`vendors/${vendorId}`).get()]);
  if (!profileSnap.exists || !vendorSnap.exists) fail('not-found', 'حساب یا فروشگاه پیدا نشد.');
  const admin = isAdminRole(profileSnap.get('role'));
  const vendor = vendorSnap.data();
  if (!admin && vendor.managerUid !== uid && vendor.ownerUid !== uid) fail('permission-denied', 'فقط مدیر همین فروشگاه مجاز است.');
  return { vendor, admin };
}
async function authorizeManagerInTransaction(tx, uid, vendorId) {
  const profileRef = db.doc(`users/${uid}`);
  const vendorRef = db.doc(`vendors/${vendorId}`);
  const [profileSnap, vendorSnap] = await Promise.all([tx.get(profileRef), tx.get(vendorRef)]);
  if (!profileSnap.exists || !vendorSnap.exists) fail('not-found', 'حساب یا فروشگاه پیدا نشد.');
  const admin = isAdminRole(profileSnap.get('role'));
  const vendor = vendorSnap.data();
  if (!admin && vendor.managerUid !== uid && vendor.ownerUid !== uid) fail('permission-denied', 'فقط مدیر همین فروشگاه مجاز است.');
  return vendor;
}
function validDocId(value) {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('/') && Buffer.byteLength(value, 'utf8') <= 1500;
}
function requireAuth(request) {
  if (!request.auth || !request.auth.uid) fail('unauthenticated', 'ابتدا وارد حساب شو.');
  return request.auth.uid;
}

exports.approveVendorManager = onCall(async request => {
  const uid = requireAuth(request);
  const vendorId = String(request.data && request.data.vendorId || '').trim();
  if (!validDocId(vendorId)) fail('invalid-argument', 'شناسه فروشگاه معتبر نیست.');
  await db.runTransaction(async tx => {
    const adminRef = db.doc(`users/${uid}`);
    const vendorRef = db.doc(`vendors/${vendorId}`);
    const [adminSnap, vendorSnap] = await Promise.all([tx.get(adminRef), tx.get(vendorRef)]);
    if (!adminSnap.exists || !isAdminRole(adminSnap.get('role'))) fail('permission-denied', 'فقط سوپرمدیر مجاز است.');
    if (!vendorSnap.exists) fail('not-found', 'فروشگاه پیدا نشد.');
    const vendor = vendorSnap.data();
    if (vendor.status === 'archived') fail('failed-precondition', 'فروشگاه بایگانی‌شده قابل تأیید مجدد نیست.');
    if (!vendor.managerApplication || !validDocId(vendor.ownerUid)) fail('failed-precondition', 'درخواست آرایشگری معتبر یا در انتظار نیست.');
    const applicantRef = db.doc(`users/${vendor.ownerUid}`);
    const applicantSnap = await tx.get(applicantRef);
    if (!applicantSnap.exists) fail('failed-precondition', 'حساب متقاضی پیدا نشد.');
    const applicantRole = String(applicantSnap.get('role') || '').normalize('NFKC').toLowerCase().replace(/[\s_\-\u200c]/g, '');
    const applicantIsAdmin = isAdminRole(applicantSnap.get('role'));
    const applicantIsManager = ['storemanager','مدیرفروشگاه','آرایشگر','ارایشگر'].includes(applicantRole);
    if (!applicantIsAdmin && !applicantIsManager && applicantRole !== 'customer' && applicantRole !== 'مشتری') {
      fail('failed-precondition', 'نقش حساب متقاضی برای مدیریت فروشگاه معتبر نیست.');
    }
    if (!applicantIsAdmin) tx.update(applicantRef, {uid: vendor.ownerUid, role: 'store_manager', updatedAt: FieldValue.serverTimestamp()});
    tx.update(vendorRef, {status:'approved', managerUid:vendor.ownerUid, managerApplication:false, managerApprovedAt:FieldValue.serverTimestamp(), managerApprovedBy:uid, updatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true, vendorId};
});

exports.assignVendorManager = onCall(async request => {
  const uid = requireAuth(request);
  const vendorId = String(request.data && request.data.vendorId || '').trim();
  const managerUid = String(request.data && request.data.managerUid || '').trim();
  if (!validDocId(vendorId) || !validDocId(managerUid)) fail('invalid-argument', 'شناسه فروشگاه یا آرایشگر معتبر نیست.');
  await db.runTransaction(async tx => {
    const adminRef = db.doc(`users/${uid}`);
    const vendorRef = db.doc(`vendors/${vendorId}`);
    const managerRef = db.doc(`users/${managerUid}`);
    const [adminSnap, vendorSnap, managerSnap] = await Promise.all([tx.get(adminRef), tx.get(vendorRef), tx.get(managerRef)]);
    if (!adminSnap.exists || !isAdminRole(adminSnap.get('role'))) fail('permission-denied', 'فقط سوپرمدیر مجاز است.');
    if (!vendorSnap.exists || !managerSnap.exists) fail('not-found', 'فروشگاه یا حساب آرایشگر پیدا نشد.');
    if (vendorSnap.get('status') === 'archived') fail('failed-precondition', 'برای فروشگاه بایگانی‌شده نمی‌توان مدیر تعیین کرد.');
    const managerRole = String(managerSnap.get('role') || '').normalize('NFKC').toLowerCase().replace(/[\s_\-\u200c]/g, '');
    if (!['storemanager','مدیرفروشگاه','آرایشگر','ارایشگر'].includes(managerRole)) fail('failed-precondition', 'حساب انتخاب‌شده نقش آرایشگر ندارد.');
    tx.set(managerRef, {uid:managerUid, role:'store_manager', storeId:vendorId, updatedAt:FieldValue.serverTimestamp()}, {merge:true});
    tx.update(vendorRef, {managerUid, updatedAt:FieldValue.serverTimestamp(), managerAssignedBy:uid, managerAssignedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true, vendorId, managerUid};
});

exports.setVendorStatus = onCall(async request => {
  const uid = requireAuth(request);
  const vendorId = String(request.data && request.data.vendorId || '').trim();
  const status = String(request.data && request.data.status || '').trim();
  if (!validDocId(vendorId) || !['approved', 'rejected'].includes(status)) fail('invalid-argument', 'شناسه فروشگاه یا وضعیت معتبر نیست.');
  await db.runTransaction(async tx => {
    const actorRef = db.doc(`users/${uid}`);
    const vendorRef = db.doc(`vendors/${vendorId}`);
    const [actorSnap, vendorSnap] = await Promise.all([tx.get(actorRef), tx.get(vendorRef)]);
    if (!actorSnap.exists || !isAdminRole(actorSnap.get('role'))) fail('permission-denied', 'فقط سوپرمدیر مجاز است.');
    if (!vendorSnap.exists) fail('not-found', 'فروشگاه پیدا نشد.');
    const vendor = vendorSnap.data();
    if (vendor.status === 'archived') fail('failed-precondition', 'فروشگاه بایگانی‌شده از این مسیر قابل فعال‌سازی نیست.');
    if (vendor.managerApplication === true && status === 'approved') fail('failed-precondition', 'تأیید درخواست آرایشگری باید از مسیر تأیید مدیر فروشگاه انجام شود.');
    tx.update(vendorRef, {
      status,
      ...(status === 'rejected' && vendor.managerApplication === true ? {managerApplication:false} : {}),
      statusUpdatedAt: FieldValue.serverTimestamp(),
      statusUpdatedBy: uid,
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return {ok:true, vendorId, status};
});

exports.archiveVendor = onCall(async request => {
  const uid = requireAuth(request);
  const vendorId = String(request.data && request.data.vendorId || '').trim();
  if (!validDocId(vendorId)) fail('invalid-argument', 'شناسه فروشگاه معتبر نیست.');
  await db.runTransaction(async tx => {
    const actorRef = db.doc(`users/${uid}`);
    const vendorRef = db.doc(`vendors/${vendorId}`);
    const [actorSnap, vendorSnap] = await Promise.all([tx.get(actorRef), tx.get(vendorRef)]);
    if (!actorSnap.exists || !isAdminRole(actorSnap.get('role'))) fail('permission-denied', 'فقط سوپرمدیر مجاز است.');
    if (!vendorSnap.exists) fail('not-found', 'فروشگاه پیدا نشد.');
    if (vendorSnap.get('status') === 'archived') return;
    tx.update(vendorRef, {status:'archived', archivedAt:FieldValue.serverTimestamp(), archivedBy:uid, updatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true, vendorId, status:'archived'};
});

exports.updateUserRole = onCall(async request => {
  const uid = requireAuth(request);
  const targetUid = String(request.data && request.data.targetUid || '').trim();
  const role = String(request.data && request.data.role || '').trim();
  const allowed = new Set(['customer', 'store_manager', 'super_admin']);
  if (!validDocId(targetUid) || !allowed.has(role)) fail('invalid-argument', 'شناسه کاربر یا نقش معتبر نیست.');
  if (targetUid === uid && role !== 'super_admin') fail('failed-precondition', 'نمی‌توانی نقش مدیریتی حساب خودت را تغییر بدهی.');
  await db.runTransaction(async tx => {
    const actorRef = db.doc(`users/${uid}`);
    const targetRef = db.doc(`users/${targetUid}`);
    const [actorSnap, targetSnap] = await Promise.all([tx.get(actorRef), tx.get(targetRef)]);
    if (!actorSnap.exists || !isAdminRole(actorSnap.get('role'))) fail('permission-denied', 'فقط سوپرمدیر مجاز است.');
    if (!targetSnap.exists) fail('not-found', 'حساب کاربر پیدا نشد.');
    if (role === 'customer') {
      const [managedVendors, ownedVendors] = await Promise.all([
        tx.get(db.collection('vendors').where('managerUid', '==', targetUid)),
        tx.get(db.collection('vendors').where('ownerUid', '==', targetUid))
      ]);
      if (!managedVendors.empty || !ownedVendors.empty) fail('failed-precondition', 'ابتدا مدیریت و مالکیت فروشگاه‌های این حساب را به فرد دیگری واگذار کنید؛ سپس نقش را به مشتری تغییر دهید.');
    }
    if (isAdminRole(targetSnap.get('role')) && role !== 'super_admin') {
      const usersSnap = await tx.get(db.collection('users'));
      const adminCount = usersSnap.docs.filter(doc => isAdminRole(doc.get('role'))).length;
      if (adminCount <= 1) fail('failed-precondition', 'نقش آخرین سوپرمدیر قابل حذف نیست.');
    }
    tx.update(targetRef, {role, updatedAt:FieldValue.serverTimestamp(), roleUpdatedBy:uid, roleUpdatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true, targetUid, role};
});

exports.approveBooking = onCall(async request => {
  const uid = requireAuth(request);
  const bookingId = String(request.data && request.data.bookingId || '').trim();
  if (!validDocId(bookingId)) fail('invalid-argument', 'شناسه نوبت معتبر نیست.');
  const bookingRef = db.doc(`bookings/${bookingId}`);
  const initial = await bookingRef.get();
  if (!initial.exists) fail('not-found', 'نوبت پیدا نشد.');
  const first = initial.data();
  if (!validDocId(first.vendorId)) fail('failed-precondition', 'شناسه فروشگاه معتبر نیست.');
  if (!validDate(first.date)) fail('failed-precondition', 'تاریخ نوبت باید میلادی و به شکل YYYY-MM-DD باشد.');
  const { vendor } = await authorizeManager(uid, first.vendorId);
  const start = toMinutes(first.time);
  const duration = serviceDuration(vendor, first.service);
  if (start === null || duration === null) fail('failed-precondition', 'ساعت یا مدت خدمت معتبر نیست؛ مدت خدمت را مدیر فروشگاه تعریف کند.');
  if (start + duration > 1440) fail('failed-precondition', 'مدت خدمت از پایان روز عبور می‌کند.');
  const lockRef = db.doc(`bookingLocks/${first.vendorId}__${first.date}`);

  await db.runTransaction(async tx => {
    const [bookingSnap, vendorSnap, lockSnap, daySnap] = await Promise.all([
      tx.get(bookingRef), tx.get(db.doc(`vendors/${first.vendorId}`)), tx.get(lockRef),
      tx.get(db.collection('bookings').where('vendorId', '==', first.vendorId).where('date', '==', first.date))
    ]);
    if (!bookingSnap.exists || !vendorSnap.exists) fail('not-found', 'نوبت یا فروشگاه پیدا نشد.');
    const b = bookingSnap.data();
    if (b.vendorId !== first.vendorId || b.date !== first.date || b.status !== PENDING) fail('failed-precondition', 'درخواست دیگر در انتظار تأیید نیست یا تغییر کرده است.');
    const currentVendor = vendorSnap.data();
    if (currentVendor.status !== 'approved') fail('failed-precondition', 'این فروشگاه در حال حاضر تأییدشده نیست.');
    if (currentVendor.managerUid !== uid && currentVendor.ownerUid !== uid) {
      const p = await tx.get(db.doc(`users/${uid}`));
      if (!p.exists || !isAdminRole(p.get('role'))) fail('permission-denied', 'اجازه تأیید این فروشگاه را نداری.');
    }
    const currentDuration = serviceDuration(currentVendor, b.service);
    const currentStart = toMinutes(b.time);
    if (currentDuration === null || currentStart === null) fail('failed-precondition', 'خدمت یا ساعت نوبت معتبر نیست.');
    const proposed = { bookingId, startMin: currentStart, endMin: currentStart + currentDuration };
    if (proposed.endMin > 1440) fail('failed-precondition', 'مدت خدمت از پایان روز عبور می‌کند.');
    const existing = [];
    for (const docSnap of daySnap.docs) {
      if (docSnap.id === bookingId) continue;
      const old = docSnap.data();
      if (!ACTIVE_CONFIRMED.has(String(old.status || '').trim())) continue;
      const oldStart = toMinutes(old.time);
      const hasVerifiedSnapshot = !!old.durationVerifiedAt;
      const oldDuration = hasVerifiedSnapshot ? Number(old.durationMinutes) : serviceDuration(currentVendor, old.service);
      if (oldStart === null || !Number.isInteger(oldDuration) || oldDuration < 5 || oldDuration > 720 || oldStart + oldDuration > 1440) {
        fail('failed-precondition', 'یک نوبت قدیمی اطلاعات ناقص یا خارج از محدوده روز دارد؛ ابتدا سوابق را بررسی کنید.');
      }
      existing.push({bookingId:docSnap.id, startMin:oldStart, endMin:oldStart + oldDuration});
    }
    if (existing.some(e => overlaps(proposed, e))) fail('already-exists', 'این ساعت با نوبت تأییدشده دیگری تداخل دارد.');
    const nextEntries = existing.concat(proposed);
    tx.set(lockRef, {
      vendorId:b.vendorId, date:b.date, entries:nextEntries,
      bookingIds:nextEntries.map(e => e.bookingId), updatedAt:FieldValue.serverTimestamp()
    });
    tx.update(bookingRef, {
      status:APPROVED, durationMinutes:currentDuration, durationVerifiedAt:FieldValue.serverTimestamp(),
      approvedAt:FieldValue.serverTimestamp(), approvedBy:uid, updatedAt:FieldValue.serverTimestamp()
    });
  });
  return {ok:true, bookingId, status:APPROVED};
});

exports.rejectBooking = onCall(async request => {
  const uid = requireAuth(request);
  const bookingId = String(request.data && request.data.bookingId || '').trim();
  if (!validDocId(bookingId)) fail('invalid-argument', 'شناسه نوبت معتبر نیست.');
  const ref = db.doc(`bookings/${bookingId}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'نوبت پیدا نشد.');
    const b = snap.data();
    if (!validDocId(b.vendorId)) fail('failed-precondition', 'شناسه فروشگاه معتبر نیست.');
    await authorizeManagerInTransaction(tx, uid, b.vendorId);
    if (b.status !== PENDING) fail('failed-precondition', 'فقط درخواست در انتظار را می‌توان رد کرد.');
    tx.update(ref, {status:'رد شده', rejectedAt:FieldValue.serverTimestamp(), rejectedBy:uid, updatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true, bookingId, status:'رد شده'};
});

exports.cancelBooking = onCall(async request => {
  const uid = requireAuth(request);
  const bookingId = String(request.data && request.data.bookingId || '').trim();
  if (!validDocId(bookingId)) fail('invalid-argument', 'شناسه نوبت معتبر نیست.');
  const ref = db.doc(`bookings/${bookingId}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) fail('not-found', 'نوبت پیدا نشد.');
    const b = snap.data();
    if (!validDocId(b.vendorId) || !validDate(b.date)) fail('failed-precondition', 'اطلاعات فروشگاه یا تاریخ نوبت معتبر نیست.');
    const customer = b.customerUid === uid;
    const confirmed = ACTIVE_CONFIRMED.has(String(b.status || '').trim());
    if (customer && b.status !== PENDING && !confirmed) fail('permission-denied', 'فقط نوبت خودت را در انتظار یا تأییدشده می‌توانی لغو کنی.');
    if (!customer) await authorizeManagerInTransaction(tx, uid, b.vendorId);
    if (!customer && !confirmed && b.status !== PENDING) fail('failed-precondition', 'وضعیت نوبت قابل لغو نیست.');
    const lockRef = db.doc(`bookingLocks/${b.vendorId}__${b.date}`);
    const lockSnap = await tx.get(lockRef);
    if (lockSnap.exists) {
      const entries = (Array.isArray(lockSnap.get('entries')) ? lockSnap.get('entries') : []).filter(e => e && e.bookingId !== bookingId);
      if (entries.length) tx.set(lockRef, {vendorId:b.vendorId, date:b.date, entries, bookingIds:entries.map(e=>e.bookingId), updatedAt:FieldValue.serverTimestamp()});
      else tx.delete(lockRef);
    }
    tx.update(ref, {status:customer?'لغو شده توسط مشتری':'لغو شده توسط آرایشگر', cancelledAt:FieldValue.serverTimestamp(), cancelledBy:uid, updatedAt:FieldValue.serverTimestamp()});
  });
  return {ok:true, bookingId, status:'لغو شده'};
});