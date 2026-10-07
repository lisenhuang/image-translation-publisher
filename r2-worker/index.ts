const MAX_BYTES=12*1024*1024;
function response(text:string,status=200){return new Response(text,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
async function authenticated(request:Request,secret:string|undefined){
 const value=request.headers.get('authorization')||'';
 if(!secret||value.length>200)return false;
 const encoder=new TextEncoder();
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(value)),crypto.subtle.digest('SHA-256',encoder.encode('Bearer '+secret))]);
 return crypto.subtle.timingSafeEqual(a,b);
}
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  if(!await authenticated(request,env.BRIDGE_TOKEN))return response('Unauthorized',401);
  const key=new URL(request.url).pathname.slice(1);
  if(!/^(original|english|checks)\/[0-9a-f-]{36}$/.test(key))return response('Invalid object key',400);
  try{
   if(request.method==='GET'){
    const object=await env.IMAGES.get(key);
    if(!object)return response('Not found',404);
    const headers=new Headers({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Length':String(object.size)});
    object.writeHttpMetadata(headers);headers.set('Cache-Control','private, no-store');
    return new Response(object.body,{headers});
   }
   if(request.method==='PUT'){
    const type=request.headers.get('content-type')||'';
    if(!['image/png','image/jpeg','image/webp'].includes(type))return response('Unsupported type',415);
    const size=Number(request.headers.get('content-length'));
    if(!Number.isSafeInteger(size)||size<1||size>MAX_BYTES)return response('Invalid size',413);
    const reader=request.body?.getReader();if(!reader)return response('Empty body',400);
    const chunks:Uint8Array[]=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){await reader.cancel();return response('Too large',413);}chunks.push(value);}
    if(length!==size)return response('Size mismatch',400);
    const data=new Uint8Array(length);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
    await env.IMAGES.put(key,data,{httpMetadata:{contentType:type,cacheControl:'private, no-store'}});
    return response('Stored',201);
   }
   if(request.method==='DELETE'){await env.IMAGES.delete(key);return response('Deleted');}
   return response('Method not allowed',405);
  }catch(error){console.error(JSON.stringify({event:'r2_operation_failed',method:request.method,error:error instanceof Error?error.name:'Unknown'}));return response('Storage temporarily unavailable',503);}
 }
} satisfies ExportedHandler<Env>;
