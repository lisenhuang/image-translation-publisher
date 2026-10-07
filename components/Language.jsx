'use client';
import {createContext,useContext,useEffect,useState} from 'react';
import {usePathname} from 'next/navigation';
import {cookieLanguage,resolveLanguage,supportedLanguages,translate} from '../lib/i18n.mjs';

const LanguageContext=createContext(null);
export function LanguageProvider({initialLanguage,hasPreference,children}){
 const [language,setLanguage]=useState(initialLanguage);
 const pathname=usePathname();
 useEffect(()=>{
  if(!hasPreference)setLanguage(resolveLanguage(cookieLanguage(document.cookie),navigator.language));
 },[hasPreference]);
 useEffect(()=>{document.documentElement.lang=language;},[language]);
 useEffect(()=>{const titles={'/login':'投稿者登录','/dashboard':'投稿工作台','/admin':'管理员工作台','/setup':'首次设置'};const brand=translate('图译',language);if(pathname==='/')document.title=language==='en'?'Hooboo':'图译 · hooboo';else if(titles[pathname])document.title=translate(titles[pathname],language)+' · '+brand;else document.title=document.title.replace(/ · (?:图译|Hooboo)$/, ' · '+brand);},[language,pathname]);
 function changeLanguage(next){
  if(!supportedLanguages.includes(next))return;
  document.cookie=`hb_lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
  setLanguage(next);
 }
 return <LanguageContext.Provider value={{language,changeLanguage,t:value=>translate(value,language),imageCount:count=>language==='zh-CN'?count+' 张图片':count+(count===1?' image':' images')}}>{children}</LanguageContext.Provider>;
}
export function useLanguage(){const context=useContext(LanguageContext);if(!context)throw Error('LanguageProvider is required');return context;}
export function LanguageSwitcher(){
 const {language,changeLanguage,t}=useLanguage();
 return <div className="language-switch" role="group" aria-label={t('语言')}><button type="button" lang="en" aria-label="English" aria-pressed={language==='en'} onClick={()=>changeLanguage('en')}>EN</button><button type="button" lang="zh-CN" aria-label="简体中文" aria-pressed={language==='zh-CN'} onClick={()=>changeLanguage('zh-CN')}>简中</button></div>;
}
