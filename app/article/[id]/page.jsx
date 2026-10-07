import Gallery from '../../../components/Gallery';
import {one,article} from '../../../lib/db.mjs';
import {notFound} from 'next/navigation';
import {requestLanguage} from '../../../lib/request-language.mjs';
import {translate} from '../../../lib/i18n.mjs';
export const dynamic='force-dynamic';
export async function generateMetadata({params}){const {id}=await params;const a=one("SELECT title_en FROM articles WHERE id=? AND status='published'",id);const {language}=await requestLanguage();return {title:a?.title_en||translate('文章',language)};}
export default async function Page({params}){const {id}=await params;const a=one("SELECT * FROM articles WHERE id=? AND status='published'",id);if(!a)notFound();return <Gallery view="article" initialArticle={article(a)}/>}
