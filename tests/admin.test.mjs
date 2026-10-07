import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const dir=mkdtempSync(path.join(tmpdir(),'hooboo-admin-'));
const legacy=new Database(path.join(dir,'gallery.sqlite'));
legacy.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL)');
legacy.prepare('INSERT INTO users VALUES (?,?,?,?)').run('legacy','old_contributor','unused',Date.now());legacy.close();
process.env.DATA_DIR=dir;process.env.STORAGE_MODE='memory';process.env.ALLOW_MEMORY_QA='1';process.env.APP_ORIGIN='https://example.test';process.env.SETUP_TOKEN=randomBytes(32).toString('hex');process.env.WORKER_TOKEN=randomBytes(32).toString('hex');
const {handle}=await import('../lib/api.mjs');
const {publicImage}=await import('../lib/media.mjs');
const {db,one,run}=await import('../lib/db.mjs');
const {hashPassword}=await import('../lib/security.mjs');
let checks=0;
async function call(route,{method='GET',body,headers={},status=200}={}){
 const h={host:'example.test',...(method==='GET'?{}:{origin:process.env.APP_ORIGIN}),...headers};let content=body;
 if(body&&!(body instanceof FormData)){h['content-type']='application/json';content=JSON.stringify(body);}
 const response=await handle(new Request('https://example.test/api/'+route,{method,headers:h,body:content}),route.split('?')[0].split('/'));
 assert.equal(response.status,status,route+': '+(response.status!==status?await response.clone().text():''));checks++;return response;
}
async function login(username,password){const response=await call('login',{method:'POST',body:{username,password}});const cookie=response.headers.get('set-cookie').split(';')[0];const session=await(await call('session',{headers:{cookie}})).json();return {cookie,'x-csrf-token':session.user.csrf};}
const original=await sharp({create:{width:120,height:80,channels:3,background:'#aac088'}}).png().toBuffer();
const english=await sharp({create:{width:120,height:80,channels:3,background:'#364b27'}}).png().toBuffer();
function upload(bytes=original){const form=new FormData();form.set('title','管理员翻译测试');form.set('text','中文正文');form.append('images',new File([bytes],'original.png',{type:'image/png'}));return form;}
function output(bytes=english){const form=new FormData();form.set('image',new File([bytes],'english.png',{type:'image/png'}));return form;}

test('admin login, role migration, private downloads and direct publication with CSRF and lease enforcement',async()=>{try{
 assert.equal(one('SELECT role FROM users WHERE id=?','legacy').role,'contributor');
 const password=randomBytes(24).toString('hex'),adminId=randomUUID();
 run('INSERT INTO users (id,username,password,created,role) VALUES (?,?,?,?,?)',adminId,'dot_admin',hashPassword(password),Date.now(),'admin');
 run('INSERT INTO users (id,username,password,created) VALUES (?,?,?,?)','owner','contributor',hashPassword(password),Date.now());
 run('INSERT INTO users (id,username,password,created) VALUES (?,?,?,?)','other','other_contributor',hashPassword(password),Date.now());
 const admin=await login('dot_admin',password),owner=await login('contributor',password),other=await login('other_contributor',password);
 assert.equal((await(await call('session',{headers:admin})).json()).user.role,'admin');
 await call('admin/submissions',{status:401});await call('admin/submissions',{headers:owner,status:403});await call('admin/submissions',{headers:other,status:403});
 const englishError=await(await call('admin/submissions',{headers:{'accept-language':'en-US'},status:401})).json();assert.equal(englishError.error,'Sign in with an administrator account first.');
 const chineseError=await(await call('admin/submissions',{headers:{'accept-language':'zh-TW'},status:401})).json();assert.equal(chineseError.error,'请先登录管理员账号。');
 const {id}=await(await call('submissions',{method:'POST',body:upload(),headers:{...owner,'idempotency-key':'admin-test'},status:201})).json();
 const article=(await(await call('admin/submissions/'+id,{headers:admin})).json()).article;
 const media=article.originals[0].id;await call('media/'+media,{status:404});await call('media/'+media,{headers:other,status:404});
 const download=await call('media/'+media+'?download=1',{headers:admin});assert.match(download.headers.get('content-disposition'),/attachment/);assert.match(download.headers.get('cache-control'),/no-store/);assert.deepEqual(Buffer.from(await download.arrayBuffer()),original);
 assert.equal((await publicImage(media+'.png')).status,404);
 const key=randomUUID();await call('worker/claim',{method:'POST',headers:{...owner,'idempotency-key':key},status:403});
 await call('worker/claim',{method:'POST',headers:{cookie:admin.cookie,'idempotency-key':key},status:403});
 await call('worker/claim',{method:'POST',headers:{...admin,'idempotency-key':key,origin:'https://evil.test'},status:403});
 const job=(await(await call('worker/claim',{method:'POST',headers:{...admin,'idempotency-key':key}})).json()).submission;
 assert.equal(job.id,id);const auth={...admin,'x-job-lease':job.lease};
 const same=(await(await call('worker/claim',{method:'POST',headers:{...admin,'idempotency-key':key}})).json()).submission;assert.equal(same.lease,job.lease);
 await call('worker/articles/'+id+'/publish',{method:'POST',headers:admin,status:409});
 await call('worker/articles/'+id+'/images/0',{method:'PUT',body:output(),headers:{...auth,'x-job-lease':'wrong'},status:409});
 await call('worker/articles/'+id+'/images/0',{method:'PUT',body:output(original),headers:auth,status:400});
 await call('worker/articles/'+id+'/complete',{method:'POST',body:{title_en:'English title'},headers:auth,status:409});
 await call('worker/articles/'+id+'/heartbeat',{method:'POST',headers:auth});
 await call('worker/articles/'+id+'/images/0',{method:'PUT',body:output(),headers:auth});
 const uploaded=one("SELECT id FROM assets WHERE article_id=? AND kind='english'",id).id;
 await call('media/'+uploaded,{status:404});assert.equal((await publicImage(uploaded+'.png')).status,404);
 await call('worker/articles/'+id+'/complete',{method:'POST',body:{title_en:'English title',text_en:'English body'},headers:auth});
 const bearer={authorization:'Bearer '+process.env.WORKER_TOKEN};await call('worker/articles/'+id+'/publish',{method:'POST',headers:bearer,status:409});
 await call('worker/articles/'+id+'/publish',{method:'POST',headers:owner,status:403});
 await call('worker/articles/'+id+'/publish',{method:'POST',headers:{cookie:admin.cookie},status:403});
 await call('worker/articles/'+id+'/publish',{method:'POST',headers:admin});const stamp=one('SELECT published FROM articles WHERE id=?',id).published;
 await call('worker/articles/'+id+'/publish',{method:'POST',headers:admin});assert.equal(one('SELECT published FROM articles WHERE id=?',id).published,stamp);
 assert.equal(one('SELECT approved FROM articles WHERE id=?',id).approved,0,'Administrator publication must not impersonate contributor approval');
 const published=await(await call('articles/'+id)).json();assert.equal(published.article.title_en,'English title');assert.ok(!('originals' in published.article));assert.ok(!('lease' in published.article));
 const publicOutput=await publicImage(uploaded+'.png');assert.equal(publicOutput.status,200);assert.deepEqual(Buffer.from(await publicOutput.arrayBuffer()),english);await call('media/'+media,{status:404});
 const second=await(await call('submissions',{method:'POST',body:upload(),headers:{...owner,'idempotency-key':'retry-test'},status:201})).json();
 const failed=(await(await call('worker/claim',{method:'POST',headers:{...admin,'idempotency-key':randomUUID()}})).json()).submission;assert.equal(failed.id,second.id);
 await call('worker/articles/'+second.id+'/fail',{method:'POST',headers:{...admin,'x-job-lease':failed.lease},body:{error:'图片文字无法辨认'}});
 await call('admin/submissions/'+second.id+'/retry',{method:'POST',headers:owner,status:403});await call('admin/submissions/'+second.id+'/retry',{method:'POST',headers:admin});assert.equal(one('SELECT status FROM articles WHERE id=?',second.id).status,'pending');
 const reclaimed=(await(await call('worker/claim',{method:'POST',headers:{...admin,'idempotency-key':randomUUID()}})).json()).submission;
 await call('admin/submissions/'+second.id+'/retry',{method:'POST',headers:admin,status:409});
 run('UPDATE articles SET lease_until=0 WHERE id=?',second.id);await call('worker/articles/'+second.id+'/heartbeat',{method:'POST',headers:{...admin,'x-job-lease':reclaimed.lease},status:409});
 await call('admin/submissions/'+second.id+'/retry',{method:'POST',headers:admin});
 run("UPDATE users SET role='contributor' WHERE id=?",adminId);await call('admin/submissions',{headers:admin,status:403});await call('worker/claim',{method:'POST',headers:{...admin,'idempotency-key':randomUUID()},status:403});
 run("UPDATE users SET role='admin' WHERE id=?",adminId);await call('logout',{method:'POST',headers:admin});await call('admin/submissions',{headers:admin,status:401});
 console.log(`${checks} admin API response checks passed, plus migration, privacy, publication and role revocation assertions.`);
}finally{db.close();rmSync(dir,{recursive:true,force:true});}});
