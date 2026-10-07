import {english} from './translations.mjs';
export const supportedLanguages=['en','zh-CN'];
export function resolveLanguage(preference,system=''){
 if(supportedLanguages.includes(preference))return preference;
 const first=String(system).split(',').map(item=>item.trim()).find(item=>item&&!/;\s*q=0(?:\.0*)?\s*$/.test(item));
 return /^zh(?:[-_;]|$)/i.test(first||'')?'zh-CN':'en';
}
export function cookieLanguage(cookie=''){return cookie.split(';').map(item=>item.trim()).find(item=>item.startsWith('hb_lang='))?.slice(8);}
export function languageForRequest(req){return resolveLanguage(req?.headers.get('x-hooboo-language')||cookieLanguage(req?.headers.get('cookie')||''),req?.headers.get('accept-language')||'');}
const reverse=new Map(Object.entries(english).map(([source,value])=>[value,source]));
const dynamicPrefixes=['续期失败：','发布成功。公开地址：','请上传第'];
export function translate(value,language='en'){
 if(typeof value!=='string')return value;
 const trimmed=value.trim(),source=Object.hasOwn(english,trimmed)?trimmed:reverse.get(trimmed);
 if(source){const result=language==='zh-CN'?source:english[source];const before=value.match(/^\s*/)[0],after=value.match(/\s*$/)[0];return (before&&!/^\s/.test(result)?before:'')+result+(after&&!/\s$/.test(result)?after:'');}
 for(const prefix of dynamicPrefixes){
  const from=language==='zh-CN'?english[prefix]:prefix;
  if(value.startsWith(from)){
   let rest=value.slice(from.length);
   if(prefix==='请上传第')rest=language==='zh-CN'?rest.replace(/\.$/,'张英文图片。'):rest.replace(/张英文图片。$/,'.');
   return (language==='zh-CN'?prefix:english[prefix])+translate(rest,language);
  }
 }
 return value;
}
