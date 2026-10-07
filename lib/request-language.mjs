import {cookies,headers} from 'next/headers';
import {resolveLanguage,supportedLanguages,translate} from './i18n.mjs';
export async function requestLanguage(){
 const [cookieStore,headerStore]=await Promise.all([cookies(),headers()]);
 const preference=cookieStore.get('hb_lang')?.value;
 return {language:resolveLanguage(preference,headerStore.get('accept-language')),hasPreference:supportedLanguages.includes(preference)};
}
export async function pageMetadata(title){const {language}=await requestLanguage();return {title:translate(title,language),robots:{index:false,follow:false}};}
