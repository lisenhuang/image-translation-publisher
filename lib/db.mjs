import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
export const root = process.env.DATA_DIR || path.resolve('data');
mkdirSync(root,{recursive:true,mode:0o700});
export const db = new Database(path.join(root,'gallery.sqlite'),{timeout:5000});
// Build workers can open a new database together. Changing journal mode may
// return SQLITE_BUSY immediately even with a busy timeout, so retry that step.
const journalDeadline=Date.now()+5000;
for(;;){
 try{
  if(db.pragma('journal_mode',{simple:true})!=='wal')db.pragma('journal_mode = WAL');
  break;
 }catch(error){
  if(error.code!=='SQLITE_BUSY'||Date.now()>=journalDeadline)throw error;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
 }
}
db.pragma('foreign_keys = ON');
// Serialize schema creation and migrations across startup processes.
db.transaction(()=>{
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),title_cn TEXT NOT NULL,title_en TEXT,text_cn TEXT,text_en TEXT,source TEXT,credit TEXT,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','ready','published','failed')),created INTEGER NOT NULL,updated INTEGER NOT NULL,published INTEGER,lease TEXT,lease_until INTEGER,error TEXT,approved INTEGER NOT NULL DEFAULT 0,request_key TEXT,UNIQUE(user_id,request_key));
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,position INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('original','english')),filename TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,bytes INTEGER NOT NULL,UNIQUE(article_id,position,kind));
CREATE TABLE IF NOT EXISTS storage_reservations(id TEXT PRIMARY KEY,bytes INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS storage_alerts(id TEXT PRIMARY KEY,blocked_at INTEGER NOT NULL,used_bytes INTEGER NOT NULL,reserved_bytes INTEGER NOT NULL,requested_bytes INTEGER NOT NULL,limit_bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS worker_claims(key TEXT PRIMARY KEY,article_id TEXT,lease TEXT,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS article_splits(parent_id TEXT PRIMARY KEY REFERENCES articles(id),created_by TEXT NOT NULL REFERENCES users(id),created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS split_children(parent_id TEXT NOT NULL REFERENCES article_splits(parent_id),source_asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),source_position INTEGER NOT NULL,child_id TEXT NOT NULL UNIQUE REFERENCES articles(id),PRIMARY KEY(parent_id,source_position));
CREATE TABLE IF NOT EXISTS article_completions(article_id TEXT PRIMARY KEY REFERENCES articles(id),lease TEXT NOT NULL,title_en TEXT NOT NULL,text_en TEXT NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS articles_status ON articles(status,created);
CREATE INDEX IF NOT EXISTS assets_filename ON assets(filename);
`);
if(!db.pragma('table_info(users)').some(column=>column.name==='role'))db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'contributor' CHECK(role IN ('contributor','admin'))");
}).immediate();
export const one = (sql,...args)=>db.prepare(sql).get(...args);
export const all = (sql,...args)=>db.prepare(sql).all(...args);
export const run = (sql,...args)=>db.prepare(sql).run(...args);
export function assets(id,kind){return all('SELECT id,position,mime,width,height,bytes FROM assets WHERE article_id=? AND kind=? ORDER BY position',id,kind);}
export function isSplit(id){return !!one('SELECT parent_id FROM article_splits WHERE parent_id=?',id);}
export function article(a,priv=false){
 const split=priv?one('SELECT created FROM article_splits WHERE parent_id=?',a.id):null;
 const provenance=priv?one('SELECT c.parent_id,c.source_asset_id,c.source_position,p.title_cn AS parent_title_cn,p.text_cn AS parent_text_cn FROM split_children c JOIN articles p ON p.id=c.parent_id WHERE c.child_id=?',a.id):null;
 const children=split?all('SELECT a.id,c.source_asset_id,c.source_position,a.title_cn,a.status FROM split_children c JOIN articles a ON a.id=c.child_id WHERE c.parent_id=? ORDER BY c.source_position',a.id):null;
 return {...(priv?{title_cn:a.title_cn,text_cn:a.text_cn,error:a.error,originals:assets(a.id,'original'),...(split?{split:{...split,children}}:{}),...(provenance?{provenance}:{})}:{}),id:a.id,title_en:a.title_en,text_en:a.text_en,credit:a.credit,source:a.source,status:split?'split':a.status,created:a.created,published:a.published,images:assets(a.id,'english')};
}
