'use client';
import {useLanguage,LanguageSwitcher} from '../components/Language';
export default function NotFound(){const {t}=useLanguage();return <main className="missing"><LanguageSwitcher/><a className="brand" href="/">{t("图译")}<span>hooboo</span></a><h1>{t("这一页，还未公开。")}</h1><p>{t("文章可能尚在整理中，或链接已失效。")}</p><a className="button primary" href="/">{t("返回作品集")}</a></main>}
