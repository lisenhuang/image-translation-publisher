import {publicImage} from '../../../lib/media.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req,{params}){const {filename}=await params;return publicImage(filename,req);}
