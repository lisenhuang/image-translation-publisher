import { randomBytes,scryptSync,timingSafeEqual,createHash } from 'node:crypto';
import {one,run,db} from './db.mjs';
export const random = ()=>randomBytes(32).toString('hex');
export const digest = v=>createHash('sha256').update(v).digest('hex');
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||!a||!b)return false; const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function hashPassword(p){const salt=random();const key=scryptSync(p,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');return `scrypt:${salt}:${key}`;}
export function checkPassword(p,h){const [,salt,key]=h.split(':');return equal(scryptSync(p,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex'),key);}
export function session(req){const v=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hb_session='))?.slice(11);if(!v)return null;return one('SELECT sessions.*, users.username, users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?',digest(v),Date.now());}
export function limit(key,max=10,period=900000){return db.transaction(()=>{const now=Date.now();run('DELETE FROM limits WHERE expires<?',now);let row=one('SELECT * FROM limits WHERE key=?',key);if(!row){run('INSERT INTO limits VALUES (?,1,?)',key,now+period);return true;}if(row.count>=max)return false;run('UPDATE limits SET count=count+1 WHERE key=?',key);return true;})();}
export function validOrigin(req,local=false){const origin=req.headers.get('origin');if(local)return origin==='http://127.0.0.1:3318'||origin==='http://localhost:3318';return !!process.env.APP_ORIGIN && origin===process.env.APP_ORIGIN;}
export function localRequest(req){const host=req.headers.get('host')||'';return /^(localhost|127\.0\.0\.1):3318$/.test(host)&&!req.headers.get('cf-connecting-ip');}
export function cookie(token,req,clear=false){return `hb_session=${clear?'':token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear?0:604800}${process.env.APP_ORIGIN?.startsWith('https:')&&!localRequest(req)?'; Secure':''}`;}
