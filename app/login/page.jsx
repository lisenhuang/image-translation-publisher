import {pageMetadata} from '../../lib/request-language.mjs';
import Gallery from '../../components/Gallery';
export const dynamic='force-dynamic';
export async function generateMetadata(){return pageMetadata('投稿者登录');}
export default function Page(){return <Gallery view="login"/>}
