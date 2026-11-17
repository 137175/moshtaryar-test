// Local pure-function checks. These do NOT emulate Firestore or Security Rules.
const assert = require('node:assert/strict');
const _test = require('./domain');
assert.equal(_test.validDate('2026-11-17'), true);
assert.equal(_test.validDate('1405/08/26'), false);
assert.equal(_test.validDate('2026-02-30'), false);
assert.equal(_test.toMinutes('09:30'), 570);
assert.equal(_test.toMinutes('24:00'), null);
assert.equal(_test.overlaps({startMin:600,endMin:630},{startMin:620,endMin:650}), true);
assert.equal(_test.overlaps({startMin:600,endMin:630},{startMin:630,endMin:660}), false);
assert.equal(_test.serviceDuration({services:[{name:'اصلاح',durationMinutes:30}]},'اصلاح'), 30);
assert.equal(_test.serviceDuration({services:[{name:'رنگ',durationMinutes:0}]},'رنگ'), null);
assert.equal(_test.isAdminRole('super_admin'), true);
assert.equal(_test.isAdminRole('سوپر_مدیر'), true);
assert.equal(_test.isAdminRole('مدیرکل'), true);
assert.equal(_test.isAdminRole('store_manager'), false);
console.log('13 local pure-function checks passed (not Emulator tests).');