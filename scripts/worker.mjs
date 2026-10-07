#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {File} from 'node:buffer';
import {randomUUID,createHash} from 'node:crypto';
const [command,folder,arg]=process.argv.slice(2);
if(!folder||!['next','heartbeat','fail','finish'].includes(command)){console.log('Usage: node scripts/worker.mjs next|heartbeat|fail|finish <job-directory> [manifest.json|error-message]');process.exit(1);}
const envPath=process.env.WORKER_ENV_FILE||'.env.production';let env={};try{env=Object.fromEntries((await readFile(envPath,'utf8')).trim().split('\n').filter(x=>x&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)];}));}catch{}
const token=process.env.WORKER_TOKEN||env.WORKER_TOKEN;if(!token)throw Error('WORKER_TOKEN is missing. Use the server .env.production, without printing its contents.');
const base=process.env.WORKER_BASE_URL||'http://127.0.0.1:3318';
const headers={Authorization:'Bearer '+token};
const sha=v=>createHash('sha256').update(v).digest('hex');
async function request(route,method='GET',body,extra={}){let content=body;const h={...headers,...extra};if(body&&!(body instanceof FormData)){h['Content-Type']='application/json';content=JSON.stringify(body);}const r=await fetch(base+'/api/'+route,{method,headers:h,body:content});if(!r.ok)throw Error(`${r.status}: ${(await r.json()).error}`);return r;}
async function store(file,data){await writeFile(path.join(folder,file),JSON.stringify(data,null,2)+'\n',{mode:0o600});}
await mkdir(folder,{recursive:true,mode:0o700});
if(command==='next'){
 let key;try{key=(await readFile(path.join(folder,'.claim-key'),'utf8')).trim();}catch{key=randomUUID();await writeFile(path.join(folder,'.claim-key'),key,{mode:0o600});}
 const {submission:a}=await(await request('worker/claim','POST',null,{'Idempotency-Key':key})).json();if(!a){await writeFile(path.join(folder,'.claim-key'),randomUUID(),{mode:0o600});console.log('No pending submissions.');process.exit(0);}
 const job={...a,original_files:[]};
 for(const asset of a.originals){const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[asset.mime];const file=String(asset.position+1).padStart(2,'0')+'-original.'+ext;const data=Buffer.from(await(await request('media/'+asset.id)).arrayBuffer());await writeFile(path.join(folder,file),data,{mode:0o600});job.original_files.push({position:asset.position,file,sha256:sha(data),width:asset.width,height:asset.height});}
 await store('job.json',job);
 try{await readFile(path.join(folder,'manifest.json'));}catch{await store('manifest.json',{title_en:'',text_en:'',layout_reviewed:false,images:job.original_files.map(x=>({position:x.position,file:String(x.position+1).padStart(2,'0')+'-english.png'}))});}
 console.log(`Downloaded ${a.originals.length} originals. Translate and inspect them, then fill manifest.json. Use heartbeat before 30 minutes elapse. Job: ${a.id}`);
}else{
 const job=JSON.parse(await readFile(path.join(folder,'job.json'),'utf8'));const lease={'X-Job-Lease':job.lease};const route='worker/articles/'+job.id;
 if(command==='heartbeat'){await request(route+'/heartbeat','POST',null,lease);console.log('Lease renewed for 30 minutes.');}
 if(command==='fail'){await request(route+'/fail','POST',{error:arg||'处理未完成，请联系站点所有者。'},lease);console.log('Failure recorded; the contributor can retry.');}
 if(command==='finish'){
 const manifest=JSON.parse(await readFile(arg||path.join(folder,'manifest.json'),'utf8'));
 if(!manifest.title_en?.trim()||manifest.layout_reviewed!==true||manifest.images?.length!==job.originals.length)throw Error('Complete title_en and every image, inspect text and layout, then set layout_reviewed=true.');
 const positions=new Set();for(const img of manifest.images){if(!Number.isInteger(img.position)||positions.has(img.position)||!job.original_files.some(x=>x.position===img.position)||path.basename(img.file)!==img.file||!/^.+\.(png|jpg|jpeg|webp)$/i.test(img.file))throw Error('Invalid output image path or position.');positions.add(img.position);const data=await readFile(path.join(folder,img.file));if(job.original_files.some(o=>o.sha256===sha(data)))throw Error('An output is identical to an original. Supply an actual English version.');}
 for(const img of manifest.images){const data=await readFile(path.join(folder,img.file));const type=/\.png$/i.test(img.file)?'image/png':/\.webp$/i.test(img.file)?'image/webp':'image/jpeg';const f=new FormData();f.set('image',new File([data],img.file,{type}));await request(route+'/images/'+img.position,'PUT',f,lease);}
 await request(route+'/complete','POST',{title_en:manifest.title_en,text_en:manifest.text_en||''},lease);
 console.log('English version saved as ready. It stays private until the contributor reviews and publishes it.');
 }
}
