import './globals.css';
import {LanguageProvider} from '../components/Language';
import {requestLanguage} from '../lib/request-language.mjs';
import {translate} from '../lib/i18n.mjs';
export async function generateMetadata(){const {language}=await requestLanguage();const brand=translate('图译',language);return {title:{default:language==='en'?'Hooboo':'图译 · hooboo',template:'%s · '+brand},icons:{icon:'/icon.svg'},description:translate('让好内容跨越语言。中文原稿，英文新篇。',language)};}
export default async function Layout({children}){const {language,hasPreference}=await requestLanguage();return <html lang={language}><body><LanguageProvider initialLanguage={language} hasPreference={hasPreference}>{children}</LanguageProvider></body></html>}
