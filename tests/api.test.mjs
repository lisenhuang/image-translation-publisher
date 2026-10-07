import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
const dir=mkdtempSync(path.join(tmpdir(),'hooboo-test-'));
process.env.DATA_DIR=dir;process.env.STORAGE_MODE='memory';process.env.ALLOW_MEMORY_QA='1';process.env.APP_ORIGIN='https://example.test';process.env.SETUP_TOKEN=randomBytes(32).toString('hex');process.env.WORKER_TOKEN=randomBytes(32).toString('hex');
const {handle}=await import('../lib/api.mjs');
const {publicImage}=await import('../lib/media.mjs');
const {db,one,run}=await import('../lib/db.mjs');
const {digest}=await import('../lib/security.mjs');
let assertions=0;
async function call(route,{method='GET',body,headers={},status=200,local=false}={}){headers={...headers};if(route==='worker/claim'&&!headers['idempotency-key'])headers['idempotency-key']=randomBytes(12).toString('hex');const h={host:local?'127.0.0.1:3318':'example.test',...(method==='GET'?{}:{origin:local?'http://127.0.0.1:3318':process.env.APP_ORIGIN}),...headers};let content=body;if(body&&!(body instanceof FormData)){h['content-type']='application/json';content=JSON.stringify(body);}const res=await handle(new Request((local?'http://127.0.0.1:3318':'https://example.test')+'/api/'+route,{method,headers:h,body:content}),route.split('?')[0].split('/'));assert.equal(res.status,status,route+': '+(res.status!==status?await res.clone().text():''));assertions++;return res;}
const png=await sharp({create:{width:60,height:40,channels:3,background:'#537348'}}).png().toBuffer();
function form(files=[png,png]){const f=new FormData();f.set('title','测试原稿');f.set('credit','测试作者');f.set('text','原文');files.forEach((b,i)=>f.append('images',new File([b],`image-${i}.png`,{type:'image/png'})));return f;}
test('complete authentication, upload, lease, review, publication and persistence flow',async()=>{
try{
 await call('submissions',{status:401});
 await call('worker/claim',{method:'POST',status:401});
 const setup={method:'POST',body:{username:'qa_user',password:randomBytes(24).toString('base64')},headers:{'x-setup-token':process.env.SETUP_TOKEN}};
 await call('setup',{...setup,status:403});await call('setup',{...setup,local:true,headers:{'x-setup-token':'wrong'},status:403});
 await call('setup',{...setup,local:true,headers:{...setup.headers,'cf-connecting-ip':'1.1.1.1'},status:403});
 await call('setup',{...setup,local:true});await call('setup',{...setup,local:true,status:410});
 assert.ok(one('SELECT password FROM users').password.startsWith('scrypt:'));assert.ok(!readFileSync(path.join(dir,'gallery.sqlite')).includes(setup.body.password));
 await call('login',{method:'POST',body:setup.body,headers:{origin:'https://evil.test'},status:403});
 await call('login',{method:'POST',body:{username:'qa_user',password:'wrong'},status:401});
 const login=await call('login',{method:'POST',body:setup.body});const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);const auth={cookie:cookie.split(';')[0]};
 const session=await (await call('session',{headers:auth})).json();auth['x-csrf-token']=session.user.csrf;
 await call('submissions',{method:'POST',headers:{cookie:auth.cookie},body:form(),status:403});
 await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'badtype'},body:form([Buffer.from('<script>bad</script>')]),status:400});
 await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'empty'},body:form([]),status:400});
 const unsafe=form();unsafe.set('source','javascript:alert(1)');await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'unsafe'},body:unsafe,status:400});
 const wrongType=form([]);wrongType.append('images',new File([png],'img.svg',{type:'image/svg+xml'}));await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'svg'},body:wrongType,status:400});
 await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'size','content-length':String(80*1024*1024)},body:form(),status:413});
 process.env.MAX_STORAGE_BYTES='1';await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'quota'},body:form(),status:507});
 const storageStatus=()=>JSON.parse(execFileSync(process.execPath,['scripts/storage-status.mjs'],{env:process.env}).toString());
 const blocked=storageStatus();assert.equal(blocked.limitBytes,1);assert.equal(blocked.usedBytes,0);assert.equal(blocked.quotaBlocked.limitBytes,1);assert.ok(blocked.quotaBlocked.requestedBytes>1);assert.ok(blocked.quotaBlocked.blockedAt>0);assert.equal(one('SELECT COUNT(*) AS n FROM storage_reservations').n,0);
 delete process.env.MAX_STORAGE_BYTES;assert.equal(storageStatus().limitBytes,10*1024**3);assert.equal(storageStatus().quotaBlocked,null,'Alerts for a previous storage cap must not trigger the current monitor');
 const created=await(await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'ordered'},body:form(),status:201})).json();const id=created.id;
 const storedBytes=one('SELECT SUM(bytes) AS n FROM assets').n;
 run('INSERT INTO storage_reservations VALUES (?,?,?)','capacity-test',10*1024**3-storedBytes,Date.now()+60000);
 run('INSERT INTO storage_reservations VALUES (?,?,?)','expired-capacity-test',123,Date.now()-1);
 const full=storageStatus();assert.equal(full.usedBytes,storedBytes);assert.equal(full.reservedBytes,10*1024**3-storedBytes);assert.equal(full.remainingBytes,0);
 await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'full-capacity'},body:form(),status:507});
 const quotaEvent=storageStatus().quotaBlocked;assert.equal(quotaEvent.limitBytes,10*1024**3);assert.equal(quotaEvent.usedBytes+quotaEvent.reservedBytes,quotaEvent.limitBytes);assert.ok(quotaEvent.requestedBytes>0);
 run("DELETE FROM storage_reservations WHERE id='capacity-test'");assert.equal(storageStatus().reservedBytes,0);
 const again=await(await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'ordered'},body:form()})).json();assert.equal(again.id,id);assert.equal(one('SELECT COUNT(*) AS n FROM articles').n,1);
 const submission=(await(await call('submissions',{headers:auth})).json()).articles[0];assert.deepEqual(submission.originals.map(x=>x.position),[0,1]);
 assert.equal((await(await call('articles')).json()).articles.length,0);
 await call('articles/'+id,{status:404});
 await call('media/'+submission.originals[0].id,{status:404});assert.equal((await publicImage(submission.originals[0].id+'.png')).status,404);const privateMedia=await call('media/'+submission.originals[0].id,{headers:auth});assert.match(privateMedia.headers.get('cache-control'),/no-store/);
 const worker={authorization:'Bearer '+process.env.WORKER_TOKEN};let claim=(await(await call('worker/claim',{method:'POST',headers:worker})).json()).submission;assert.equal(claim.id,id);let job={...worker,'x-job-lease':claim.lease};const originalClaimKey=one('SELECT key FROM worker_claims WHERE article_id=?',id).key;const retryClaim=(await(await call('worker/claim',{method:'POST',headers:{...worker,'idempotency-key':originalClaimKey}})).json()).submission;assert.equal(retryClaim.lease,claim.lease);
 await call('worker/articles/'+id+'/complete',{method:'POST',headers:job,body:{title_en:'An English title'},status:409});
 await call('worker/articles/'+id+'/heartbeat',{method:'POST',headers:job});
 run('UPDATE articles SET lease_until=0 WHERE id=?',id);
 const stale=job;
 claim=(await(await call('worker/claim',{method:'POST',headers:worker})).json()).submission;job={...worker,'x-job-lease':claim.lease};assert.notEqual(stale['x-job-lease'],claim.lease);
 await call('worker/articles/'+id+'/complete',{method:'POST',headers:stale,body:{title_en:'Stale'},status:409});
 await call('worker/articles/'+id+'/fail',{method:'POST',headers:job,body:{error:'测试：处理被中断'}});
 assert.equal(one('SELECT status FROM articles WHERE id=?',id).status,'failed');
 await call('submissions/'+id+'/retry',{method:'POST',headers:auth});
 claim=(await(await call('worker/claim',{method:'POST',headers:worker})).json()).submission;job={...worker,'x-job-lease':claim.lease};
 for(let i=0;i<2;i++){const f=new FormData();f.set('image',new File([png],'english.png',{type:'image/png'}));await call('worker/articles/'+id+'/images/'+i,{method:'PUT',headers:job,body:f});}
 const f=new FormData();f.set('image',new File([png],'retry.jpg',{type:'image/jpeg'}));await call('worker/articles/'+id+'/images/0',{method:'PUT',headers:job,body:f});assert.equal(one("SELECT COUNT(*) AS n FROM assets WHERE kind='english'").n,2);
 const englishId=one("SELECT id FROM assets WHERE kind='english' AND position=0").id;await call('media/'+englishId,{status:404});assert.equal((await publicImage(englishId+'.png')).status,404);await call('media/'+englishId,{headers:auth});
 await call('worker/articles/'+id+'/complete',{method:'POST',headers:job,body:{title_en:'An English title',text_en:'English body.'}});
 await call('worker/articles/'+id+'/publish',{method:'POST',headers:worker,status:409});
 await call('articles/'+id,{status:404});
 await call('submissions/'+id+'/publish',{method:'POST',headers:auth});const stamp=one('SELECT published FROM articles').published;
 await call('submissions/'+id+'/publish',{method:'POST',headers:auth});await call('worker/articles/'+id+'/publish',{method:'POST',headers:worker});assert.equal(one('SELECT published FROM articles').published,stamp);
 const pub=(await(await call('articles/'+id)).json()).article;assert.equal(pub.title_en,'An English title');assert.ok(!('title_cn' in pub));assert.ok(!('originals' in pub));assert.deepEqual(pub.images.map(i=>i.position),[0,1]);
 const cdnMedia=await publicImage(englishId+'.png');assert.equal(cdnMedia.status,200);assert.match(cdnMedia.headers.get('cache-control'),/public.*s-maxage=604800/);assert.equal((await publicImage(englishId+'.jpg')).status,404);await call('media/'+englishId);await call('media/'+submission.originals[0].id,{status:404});
 const persistent=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import Database from 'better-sqlite3';const db=new Database(process.env.DATA_DIR+'/gallery.sqlite');console.log(JSON.stringify(db.prepare('SELECT status FROM articles').get()));"],{cwd:process.cwd(),env:process.env}).toString());assert.equal(persistent.status,'published');
 // Browser MIME types follow extensions; storage and responses must follow bytes.
 const jpeg=await sharp(png).jpeg().toBuffer(),webp=await sharp(png).webp().toBuffer();
 for(const [bytes,name,declared,actual] of [[png,'export.jpg','image/jpeg','image/png'],[jpeg,'export.png','image/png','image/jpeg'],[webp,'export.jpg','image/jpeg','image/webp']]){
  const mixed=form([]);mixed.append('images',new File([bytes],name,{type:declared}));
  const result=await(await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'mixed-'+actual},body:mixed,status:201})).json();
  const asset=one('SELECT * FROM assets WHERE article_id=?',result.id);assert.equal(asset.mime,actual);assert.equal(asset.bytes,bytes.length);
  const media=await call('media/'+asset.id,{headers:auth});assert.equal(media.headers.get('content-type'),actual);assert.deepEqual(Buffer.from(await media.arrayBuffer()),bytes);
  const download=await call('media/'+asset.id+'?download=1',{headers:auth});assert.match(download.headers.get('content-disposition'),new RegExp('\\.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[actual])));
  await call('media/'+asset.id,{status:404});
 }
 const disguised=form([]);disguised.append('images',new File([await sharp(png).gif().toBuffer()],'unsupported.jpg',{type:'image/jpeg'}));
 await call('submissions',{method:'POST',headers:{...auth,'idempotency-key':'unsupported-content'},body:disguised,status:400});
 await call('logout',{method:'POST',headers:auth});await call('submissions',{headers:auth,status:401});
 const expiredLogin=await call('login',{method:'POST',body:setup.body});const expiredCookie=expiredLogin.headers.get('set-cookie').split(';')[0];run('UPDATE sessions SET expires=0');await call('submissions',{headers:{cookie:expiredCookie},status:401});
 for(let i=0;i<10;i++){await call('login',{method:'POST',body:{username:'nobody',password:'wrong'},headers:{'cf-connecting-ip':'rate-test'},status:401});}await call('login',{method:'POST',body:setup.body,headers:{'cf-connecting-ip':'rate-test'},status:429});
 assert.equal(existsSync(path.join(dir,'files')),false,'Images must not be written to application disk');
 console.log(`${assertions} API response checks passed, plus privacy, cookie, ordering, retry and persistence assertions.`);
}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
