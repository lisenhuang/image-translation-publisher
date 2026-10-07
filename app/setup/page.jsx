import {pageMetadata} from '../../lib/request-language.mjs';
import Gallery from '../../components/Gallery';
export const dynamic='force-dynamic';
export async function generateMetadata(){return pageMetadata('首次设置');}
export default function Page(){return <Gallery view="setup"/>}
