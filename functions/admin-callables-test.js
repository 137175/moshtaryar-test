// Admin callable integration tests. Emulator-only; refuses non-demo projects.
const PROJECT_ID='demo-moshtaryar-emulator';
if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==PROJECT_ID)throw Error('Refusing non-demo project');
process.env.GCLOUD_PROJECT=PROJECT_ID;process.env.FIREBASE_CONFIG=JSON.stringify({projectId:PROJECT_ID});
process.env.FIRESTORE_EMULATOR_HOST||='127.0.0.1:8080';process.env.FIREBASE_AUTH_EMULATOR_HOST||='127.0.0.1:9099';
const {initializeApp,getApps}=require('firebase-admin/app'),{getAuth}=require('firebase-admin/auth'),{getFirestore}=require('firebase-admin/firestore');
if(!getApps().length)initializeApp({projectId:PROJECT_ID});const auth=getAuth(),db=getFirestore();
const api='fake-api-key-for-emulator',base='http://127.0.0.1:5001/'+PROJECT_ID+'/us-central1/';
const users=[],docs=[];const assert=(v,m)=>{if(!v)throw Error('ASSERTION FAILED: '+m)};
async function user(n){const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key='+api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:n+'@moshtaryar.test',password:'test-password-123',returnSecureToken:true})});const b=await r.json();if(!r.ok)throw Error(JSON.stringify(b));users.push(b.localId);return{uid:b.localId,token:b.idToken}}
async function seed(p,d){docs.push(p);await db.doc(p).set(d)}
async function call(u,n,d){const r=await fetch(base+n,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+u.token},body:JSON.stringify({data:d})});const b=await r.json();return{ok:r.ok&&!!b.result,body:b}}
async function yes(u,n,d){const r=await call(u,n,d);assert(r.ok,n+' expected success: '+JSON.stringify(r.body))}
async function no(u,n,d){const r=await call(u,n,d);assert(!r.ok&&r.body.error,n+' expected denial: '+JSON.stringify(r.body))}
const get=async p=>(await db.doc(p).get()).data();
(async()=>{const s=String(Date.now()),a=await user('admin'+s),a2=await user('admin2'+s),c=await user('customer'+s),app=await user('applicant'+s),m=await user('manager'+s),free=await user('free'+s);
const ids=['status','archive','apply','assign','owned','blocked','badassign'].map(x=>'adm-'+x+'-'+s);
try{
for(const u of[a,a2])await seed('users/'+u.uid,{uid:u.uid,role:'super_admin'});
for(const u of[c,app,free])await seed('users/'+u.uid,{uid:u.uid,role:'customer'});
await seed('users/'+m.uid,{uid:m.uid,role:'store_manager'});
await seed('vendors/'+ids[0],{ownerUid:app.uid,status:'pending',managerApplication:false});
await seed('vendors/'+ids[1],{ownerUid:app.uid,status:'approved'});
await seed('vendors/'+ids[2],{ownerUid:app.uid,status:'pending',managerApplication:true});
await seed('vendors/'+ids[3],{ownerUid:app.uid,status:'approved'});
const oldManaged='adm-old-managed-'+s;await seed('vendors/'+oldManaged,{ownerUid:app.uid,managerUid:m.uid,status:'approved'});await db.doc('users/'+m.uid).update({storeId:oldManaged});

for(const [n,d] of [['setVendorStatus',{vendorId:ids[0],status:'approved'}],['archiveVendor',{vendorId:ids[1]}],['assignVendorManager',{vendorId:ids[3],managerUid:m.uid}],['approveVendorManager',{vendorId:ids[2]}],['updateUserRole',{targetUid:free.uid,role:'store_manager'}]])await no(c,n,d);
console.log('PASS: customer denied on all five admin callables.');
await yes(a,'setVendorStatus',{vendorId:ids[0],status:'approved'});assert((await get('vendors/'+ids[0])).status==='approved','status update');
await yes(a,'archiveVendor',{vendorId:ids[1]});assert((await get('vendors/'+ids[1])).status==='archived','archive status');
await no(a,'setVendorStatus',{vendorId:ids[1],status:'approved'});console.log('PASS: status update, archive, and no reactivation.');
await yes(a,'approveVendorManager',{vendorId:ids[2]});let v=await get('vendors/'+ids[2]);assert(v.status==='approved'&&v.managerUid===app.uid&&!v.managerApplication,'application vendor fields');assert((await get('users/'+app.uid)).role==='store_manager','applicant promoted');
await seed('vendors/'+ids[5],{ownerUid:app.uid,status:'pending',managerApplication:true});await no(a,'setVendorStatus',{vendorId:ids[5],status:'approved'});
await yes(a,'assignVendorManager',{vendorId:ids[3],managerUid:m.uid});v=await get('vendors/'+ids[3]);assert(v.managerUid===m.uid,'managerUid');assert((await get('users/'+m.uid)).storeId===ids[3],'manager storeId');assert((await get('vendors/'+oldManaged)).managerUid===null,'previous store manager assignment must be cleared');
await seed('vendors/'+ids[6],{ownerUid:app.uid,status:'approved'});await no(a,'assignVendorManager',{vendorId:ids[6],managerUid:free.uid});console.log('PASS: manager application and assignment constraints.');
await yes(a,'updateUserRole',{targetUid:free.uid,role:'store_manager'});await yes(a,'updateUserRole',{targetUid:free.uid,role:'customer'});assert((await get('users/'+free.uid)).role==='customer','role changes');
await seed('vendors/'+ids[4],{ownerUid:free.uid,status:'approved'});
await no(a,'updateUserRole',{targetUid:free.uid,role:'customer'}); // freeUser still owns ids[4]
await no(a,'updateUserRole',{targetUid:m.uid,role:'customer'}); // assigned manager
await yes(a,'updateUserRole',{targetUid:a2.uid,role:'customer'});await no(a,'updateUserRole',{targetUid:a.uid,role:'customer'});
console.log('PASS: role changes, vendor-owner/manager protection, and self-demotion guard.');
console.log('PASS: all admin callable integration scenarios completed.');
}finally{await Promise.all(docs.map(p=>db.doc(p).delete().catch(()=>{})));await Promise.all(users.map(uid=>auth.deleteUser(uid).catch(()=>{})))}})().catch(e=>{console.error(e);process.exitCode=1});
