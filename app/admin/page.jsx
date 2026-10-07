import {pageMetadata} from '../../lib/request-language.mjs';
import Admin from '../../components/Admin';
export const dynamic='force-dynamic';
export async function generateMetadata(){return pageMetadata('管理员工作台');}
export default function Page(){return <Admin/>;}
