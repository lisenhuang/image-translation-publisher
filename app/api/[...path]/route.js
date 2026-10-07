import {handle} from '../../../lib/api.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handler(req,{params}){const {path}=await params;return handle(req,path);}
export {handler as GET,handler as POST,handler as PUT};
