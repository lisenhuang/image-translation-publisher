import {one,root} from './db.mjs';
import {getObject} from './storage.mjs';
import {languageForRequest,translate} from './i18n.mjs';
export async function publicImage(filename,req){
 const language=languageForRequest(req);
 const match=/^([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(filename);
 const missing=()=>new Response(translate('图片不存在。',language),{status:404,headers:{'Cache-Control':'no-store'}});
 if(!match)return missing();
 const a=one("SELECT assets.* FROM assets JOIN articles ON articles.id=assets.article_id WHERE assets.id=? AND assets.kind='english' AND articles.status='published'",match[1]);
 if(!a||{'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[a.mime]!==match[2])return missing();
 try{return new Response(await getObject(a.filename),{headers:{'Content-Type':a.mime,'Content-Length':String(a.bytes),'Cache-Control':'public, max-age=86400, s-maxage=604800, immutable','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});}catch(e){return e.name==='ObjectNotFound'?missing():new Response(translate('图片暂时无法读取。',language),{status:503,headers:{'Cache-Control':'no-store'}});}
}
