import {randomUUID} from 'node:crypto';
import {putObject,getObject,deleteObject} from './storage.mjs';
import sharp from 'sharp';
import {db,one,all,run,root,assets,article} from './db.mjs';
import {random,digest,equal,hashPassword,checkPassword,session,limit,validOrigin,localRequest,cookie} from './security.mjs';
import {languageForRequest,translate} from './i18n.mjs';
const reply=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(s,m)=>{throw new HttpError(s,m);};
function text(v,max,required=false){if(v===null||v===undefined)v='';if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail(400,'请检查输入内容的长度。');return v.trim();}
async function bounded(req,max){const declared=Number(req.headers.get('content-length')||0);if(declared>max)fail(413,'上传内容过大，请减少图片数量或压缩图片。');const reader=req.body?.getReader();if(!reader) return Buffer.alloc(0);let len=0;const list=[];for(;;){const {done,value}=await reader.read();if(done)break;len+=value.length;if(len>max){await reader.cancel();fail(413,'上传内容过大，请减少图片数量或压缩图片。');}list.push(Buffer.from(value));}return Buffer.concat(list);}
async function json(req){if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'请使用正确的提交格式。');try{return JSON.parse((await bounded(req,150000)).toString());}catch(e){if(e instanceof HttpError)throw e;fail(400,'提交内容格式不正确。');}}
async function multipart(req){if(!req.headers.get('content-type')?.startsWith('multipart/form-data;'))fail(415,'请使用图片上传表单。');try{return await new Response(await bounded(req,76*1024*1024),{headers:{'Content-Type':req.headers.get('content-type')}}).formData();}catch(e){if(e instanceof HttpError)throw e;fail(400,'上传表单不完整，请重试。');}}
async function imageFile(f){
 if(!f||typeof f.arrayBuffer!=='function'||f.size<1||f.size>12*1024*1024)fail(400,'每张图片需小于 12 MB。');
 if(!['image/jpeg','image/png','image/webp'].includes(f.type))fail(400,'仅支持 JPG、PNG 和 WebP 图片。');
 const bytes=Buffer.from(await f.arrayBuffer());let meta;
 try{meta=await sharp(bytes,{limitInputPixels:40000000}).metadata();}catch{fail(400,'图片无法读取或尺寸过大。');}
 const mime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[meta.format];
 if(!mime||meta.pages>1||!meta.width||!meta.height)fail(400,'请上传有效的静态 JPG、PNG 或 WebP 图片。');
 try{await sharp(bytes,{limitInputPixels:40000000}).stats();}catch{fail(400,'图片无法读取或尺寸过大。');}
 // Some exported PNGs have .jpg names. Store the decoded format, preserving bytes.
 return {bytes,mime,width:meta.width,height:meta.height};
}
function owned(id,s){const a=one('SELECT * FROM articles WHERE id=? AND user_id=?',id,s.user_id);if(!a)fail(404,'未找到这篇文章。');return a;}
function requireAdmin(req,s){if(!s)fail(401,'请先登录管理员账号。');if(s.role!=='admin')fail(403,'此操作需要管理员权限。');if(req.method!=='GET'&&(!validOrigin(req)||!equal(req.headers.get('x-csrf-token'),s.csrf)))fail(403,'请求验证失败，请刷新页面后重试。');}
function adminArticle(a){return {...article(a,true),contributor:one('SELECT username FROM users WHERE id=?',a.user_id)?.username,lease:a.status==='processing'&&a.lease_until>Date.now()?a.lease:null,lease_until:a.lease_until};}
function publishable(a){const originals=assets(a.id,'original'),english=assets(a.id,'english');if(a.status!=='ready'||!a.title_en?.trim()||!originals.length||originals.length!==english.length||originals.some((x,i)=>x.position!==english[i].position))fail(409,'请完成英文标题和全部英文图片后再发布。');}
function lease(id,token){const a=one('SELECT * FROM articles WHERE id=?',id);if(!a||a.status!=='processing'||!equal(a.lease,token)||a.lease_until<Date.now())fail(409,'处理任务已过期，请重新领取。');return a;}
function reserveStorage(bytes){
 const result=db.transaction(()=>{
  run('DELETE FROM storage_reservations WHERE expires<?',Date.now());
  const used=one('SELECT COALESCE(SUM(bytes),0) AS n FROM assets').n;
  const reserved=one('SELECT COALESCE(SUM(bytes),0) AS n FROM storage_reservations').n;
  const max=Number(process.env.MAX_STORAGE_BYTES||10737418240);
  if(used+reserved+bytes>max){
   run("INSERT INTO storage_alerts VALUES ('quota',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET blocked_at=excluded.blocked_at,used_bytes=excluded.used_bytes,reserved_bytes=excluded.reserved_bytes,requested_bytes=excluded.requested_bytes,limit_bytes=excluded.limit_bytes",Date.now(),used,reserved,bytes,max);
   return null;
  }
  const id=randomUUID();run('INSERT INTO storage_reservations VALUES (?,?,?)',id,bytes,Date.now()+1800000);return id;
 })();
 // Throw after commit so the blocked-upload event survives the HTTP error.
 if(result===null)fail(507,'站点图片存储空间不足，请联系管理员。');
 return result;
}
async function saveImage(a,pos,kind,img){const id=randomUUID(),filename=(kind==='original'?'original/':'english/')+id,reservation=reserveStorage(img.bytes.length);try{await putObject(filename,img.bytes,img.mime);let old;db.transaction(()=>{if(kind==='english')lease(a.id,a.lease);old=one('SELECT * FROM assets WHERE article_id=? AND position=? AND kind=?',a.id,pos,kind);if(old)run('DELETE FROM assets WHERE id=?',old.id);run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?)',id,a.id,pos,kind,filename,img.mime,img.width,img.height,img.bytes.length);run('DELETE FROM storage_reservations WHERE id=?',reservation);})();if(old)await deleteObject(old.filename).catch(()=>{});return id;}catch(e){await deleteObject(filename).catch(()=>{});run('DELETE FROM storage_reservations WHERE id=?',reservation);throw e;}}
export async function handle(req,segments){try{return await route(req,segments);}catch(e){const language=languageForRequest(req);if(e instanceof HttpError)return reply({error:translate(e.message,language),error_key:e.message},e.status);console.error('API failure:',e?.name);const message='服务器暂时无法完成操作，请稍后重试。';return reply({error:translate(message,language),error_key:message},500);}}
async function route(req,p){const method=req.method,route=p.join('/'),s=session(req);
if(route==='health'&&method==='GET')return reply({ok:true});
if(route==='session'&&method==='GET')return reply({user:s?{username:s.username,role:s.role,csrf:s.csrf}:null});
if(p[0]==='admin'){
 requireAdmin(req,s);
 if(route==='admin/submissions'&&method==='GET')return reply({articles:all("SELECT * FROM articles ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 WHEN 'ready' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END,created").map(adminArticle)});
 if(p[1]==='submissions'&&p[2]&&p[3]==='retry'&&method==='POST'){db.transaction(()=>{const a=one('SELECT * FROM articles WHERE id=?',p[2]);if(!a)fail(404,'未找到这篇文章。');if(a.status!=='failed'&&!(a.status==='processing'&&a.lease_until<Date.now()))fail(409,'这篇文章暂时不能重新提交处理。');run("UPDATE articles SET status='pending',lease=NULL,lease_until=NULL,error=NULL,updated=? WHERE id=?",Date.now(),a.id);})();return reply({ok:true});}
 if(p[1]==='submissions'&&p[2]&&method==='GET'){const a=one('SELECT * FROM articles WHERE id=?',p[2]);if(!a)fail(404,'未找到这篇文章。');return reply({article:adminArticle(a)});}
 fail(404,'未找到管理接口。');
}
if(route==='setup'&&method==='POST'){
 if(!localRequest(req)||!validOrigin(req,true)||!equal(req.headers.get('x-setup-token'),process.env.SETUP_TOKEN))fail(403,'首次设置仅限站点所有者通过安全连接完成。');
 if(one('SELECT id FROM users LIMIT 1'))fail(410,'首次设置已完成。');
 if(!limit('setup',10))fail(429,'尝试次数过多，请稍后再试。');
 const b=await json(req);const username=text(b.username,40,true);if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||typeof b.password!=='string'||b.password.length<12||b.password.length>128)fail(400,'用户名需为 3 至 40 位字母、数字或下划线。密码需为 12 至 128 位。');
 const hash=hashPassword(b.password);db.transaction(()=>{if(one('SELECT id FROM users LIMIT 1'))fail(410,'首次设置已完成。');run('INSERT INTO users (id,username,password,created) VALUES (?,?,?,?)',randomUUID(),username,hash,Date.now());})();return reply({ok:true});
}
if(route==='login'&&method==='POST'){
 if(!validOrigin(req))fail(403,'请求来源不正确，请刷新页面。');
 const b=await json(req);const ip=digest(req.headers.get('cf-connecting-ip')||'local');
 if(!limit('login:'+ip,10)||!limit('login-global',100,3600000))fail(429,'登录尝试过多，请 15 分钟后再试。');
 const name=text(b.username,40);if(typeof b.password!=='string'||b.password.length>128)fail(400,'账号或密码不正确。');const user=one('SELECT * FROM users WHERE username=?',name);
 const dummy='scrypt:dummy:'+ '0'.repeat(128);if(!checkPassword(b.password,user?.password||dummy)||!user)fail(401,'账号或密码不正确。');
 const tok=random();run('DELETE FROM sessions WHERE expires<?',Date.now());run('INSERT INTO sessions VALUES (?,?,?,?)',digest(tok),user.id,random(),Date.now()+604800000);return reply({ok:true},200,{'Set-Cookie':cookie(tok,req)});
}
if(p[0]==='worker'){
 const bearer=process.env.WORKER_TOKEN&&equal(req.headers.get('authorization'),'Bearer '+process.env.WORKER_TOKEN);
 if(!bearer)requireAdmin(req,s);
 const admin=!bearer&&s?.role==='admin';
 if(route==='worker/claim'&&method==='POST'){
 const key=text(req.headers.get('idempotency-key'),100,true);
 const result=db.transaction(()=>{const now=Date.now();run('DELETE FROM worker_claims WHERE created<?',now-86400000);const previous=one('SELECT * FROM worker_claims WHERE key=?',key);if(previous){if(!previous.article_id)return null;const a=one('SELECT * FROM articles WHERE id=?',previous.article_id);if(!a||a.status!=='processing'||!equal(a.lease,previous.lease)||a.lease_until<now)fail(409,'此领取请求已过期或已完成，请使用新的请求编号。');return {...article(a,true),lease:a.lease,lease_until:a.lease_until};}const a=one("SELECT * FROM articles WHERE status='pending' OR (status='processing' AND lease_until<?) ORDER BY created LIMIT 1",now);if(!a){run('INSERT INTO worker_claims VALUES (?,NULL,NULL,?)',key,now);return null;}const tok=random();run('INSERT INTO worker_claims VALUES (?,?,?,?)',key,a.id,tok,now);run("UPDATE articles SET status='processing',lease=?,lease_until=?,updated=?,error=NULL WHERE id=?",tok,now+1800000,now,a.id);return {...article({...a,status:'processing'},true),lease:tok,lease_until:now+1800000};})();return reply({submission:result});
 }
 if(p[1]==='articles'&&p[2]){
 const id=p[2],op=p[3];
 if(op==='publish'&&method==='POST'){db.transaction(()=>{const a=one('SELECT * FROM articles WHERE id=?',id);if(!a)fail(404,'未找到这篇文章。');if(a.status==='published')return;publishable(a);if(!admin&&!a.approved)fail(409,'英文内容需要投稿者确认后才能发布。');run("UPDATE articles SET status='published',published=?,updated=? WHERE id=?",Date.now(),Date.now(),id);})();return reply({ok:true,id,url:'/article/'+id});}
 const a=lease(id,req.headers.get('x-job-lease'));
 if(op==='heartbeat'&&method==='POST'){run('UPDATE articles SET lease_until=? WHERE id=?',Date.now()+1800000,id);return reply({ok:true});}
 if(op==='images'&&p[4]&&method==='PUT'){const pos=Number(p[4]),original=one("SELECT id,filename FROM assets WHERE article_id=? AND position=? AND kind='original'",id,pos);if(!Number.isInteger(pos)||!original)fail(400,'图片序号不正确。');const form=await multipart(req),img=await imageFile(form.get('image'));if(admin&&digest(img.bytes)===digest(Buffer.from(await new Response(await getObject(original.filename)).arrayBuffer())))fail(400,'英文图片与原稿完全相同，请上传实际翻译后的图片。');lease(id,req.headers.get('x-job-lease'));const assetId=await saveImage(a,pos,'english',img);return reply({ok:true,id:assetId});}
 if(op==='complete'&&method==='POST'){const b=await json(req);const title=text(b.title_en,200,true),body=text(b.text_en,100000);db.transaction(()=>{lease(id,req.headers.get('x-job-lease'));const originals=assets(id,'original'),english=assets(id,'english');if(!originals.length||originals.length!==english.length||originals.some((x,i)=>x.position!==english[i].position))fail(409,'英文图片尚未全部上传。');run("UPDATE articles SET title_en=?,text_en=?,status='ready',lease=NULL,lease_until=NULL,error=NULL,updated=? WHERE id=?",title,body,Date.now(),id);})();return reply({ok:true});}
 if(op==='fail'&&method==='POST'){const b=await json(req);lease(id,req.headers.get('x-job-lease'));run("UPDATE articles SET status='failed',error=?,lease=NULL,lease_until=NULL,updated=? WHERE id=?",text(b.error,1000,true),Date.now(),id);return reply({ok:true});}
 }
 fail(404,'未找到处理接口。');
}
if(p[0]==='media'&&p[1]&&method==='GET'){
 const a=one('SELECT assets.*, articles.status,articles.user_id FROM assets JOIN articles ON articles.id=assets.article_id WHERE assets.id=?',p[1]);if(!a)fail(404,'图片不存在。');const worker=process.env.WORKER_TOKEN&&equal(req.headers.get('authorization'),'Bearer '+process.env.WORKER_TOKEN);
 if(!(a.kind==='english'&&a.status==='published')&&!worker&&s?.role!=='admin'&&s?.user_id!==a.user_id)fail(404,'图片不存在。');
 const download=new URL(req.url).searchParams.get('download')==='1',ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[a.mime];
 return new Response(await getObject(a.filename),{headers:{'Content-Type':a.mime,'Content-Length':String(a.bytes),'Cache-Control':a.kind==='english'&&a.status==='published'&&!download?'public, max-age=3600':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':download?`attachment; filename="${a.position+1}-${a.kind}.${ext}"`:'inline'}});
}
if(route==='articles'&&method==='GET')return reply({articles:all("SELECT * FROM articles WHERE status='published' ORDER BY published DESC").map(a=>article(a))});
if(p[0]==='articles'&&p[1]&&method==='GET'){const a=one("SELECT * FROM articles WHERE id=? AND status='published'",p[1]);if(!a)fail(404,'这篇文章尚未公开。');return reply({article:article(a)});}
if(!s)fail(401,'请先登录。');
if(method!=='GET'&&(!validOrigin(req)||!equal(req.headers.get('x-csrf-token'),s.csrf)))fail(403,'请求验证失败，请刷新页面后重试。');
if(route==='logout'&&method==='POST'){run('DELETE FROM sessions WHERE token=?',s.token);return reply({ok:true},200,{'Set-Cookie':cookie('',req,true)});}
if(route==='submissions'&&method==='GET')return reply({articles:all('SELECT * FROM articles WHERE user_id=? ORDER BY created DESC',s.user_id).map(a=>article(a,true))});
if(route==='submissions'&&method==='POST'){
 const requestKey=text(req.headers.get('idempotency-key'),100,true);const existing=one('SELECT * FROM articles WHERE user_id=? AND request_key=?',s.user_id,requestKey);if(existing)return reply({ok:true,id:existing.id});
 if(!limit('upload:'+s.user_id,20,3600000))fail(429,'提交次数过多，请稍后再试。');
 const form=await multipart(req);const title=text(form.get('title'),200,true),body=text(form.get('text'),100000),source=text(form.get('source'),2000),credit=text(form.get('credit'),200);
 if(source){try{if(!['https:','http:'].includes(new URL(source).protocol))throw Error();}catch{fail(400,'来源链接需以 http:// 或 https:// 开头。');}}
 const files=form.getAll('images');if(files.length<1||files.length>20||files.reduce((n,f)=>n+f.size,0)>72*1024*1024)fail(400,'请上传 1 至 20 张图片，总大小不超过 72 MB。');
 const imgs=[];for(const f of files)imgs.push(await imageFile(f));
 const reservation=reserveStorage(imgs.reduce((n,i)=>n+i.bytes.length,0));
 const id=randomUUID(),created=Date.now(),written=[];
 try{for(let i=0;i<imgs.length;i++){const filename='original/'+randomUUID();written.push({filename,...imgs[i],position:i});await putObject(filename,imgs[i].bytes,imgs[i].mime);}
 db.transaction(()=>{run('INSERT INTO articles (id,user_id,title_cn,text_cn,source,credit,created,updated,request_key) VALUES (?,?,?,?,?,?,?,?,?)',id,s.user_id,title,body,source,credit,created,created,requestKey);for(const img of written)run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?)',randomUUID(),id,img.position,'original',img.filename,img.mime,img.width,img.height,img.bytes.length);run('DELETE FROM storage_reservations WHERE id=?',reservation);})();
 }catch(e){run('DELETE FROM storage_reservations WHERE id=?',reservation);for(const img of written)await deleteObject(img.filename).catch(()=>{});const winner=one('SELECT id FROM articles WHERE user_id=? AND request_key=?',s.user_id,requestKey);if(winner)return reply({ok:true,id:winner.id});throw e;}
 return reply({ok:true,id},201);
}
if(p[0]==='submissions'&&p[1]){
 const a=owned(p[1],s),op=p[2];
 if(op==='retry'&&method==='POST'){if(a.status!=='failed'&&!(a.status==='processing'&&a.lease_until<Date.now()))fail(409,'这篇文章暂时不能重新提交处理。');run("UPDATE articles SET status='pending',lease=NULL,lease_until=NULL,error=NULL,updated=? WHERE id=?",Date.now(),a.id);return reply({ok:true});}
 if(op==='publish'&&method==='POST'){db.transaction(()=>{const current=owned(a.id,s);if(current.status==='published')return;publishable(current);run("UPDATE articles SET approved=1,status='published',published=?,updated=? WHERE id=?",Date.now(),Date.now(),a.id);})();return reply({ok:true,id:a.id});}
}
fail(404,'未找到此页面。');
}
