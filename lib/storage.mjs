const memory=new Map();
const mode=()=>process.env.STORAGE_MODE||'r2';
function keyValid(key){if(!/^(original|english|checks)\/[0-9a-f-]{36}$/.test(key))throw Error('Invalid storage key');}
async function bridge(key,method='GET',body,mime){
 keyValid(key);
 const url=process.env.R2_BRIDGE_URL,token=process.env.R2_BRIDGE_TOKEN;
 if(!url?.startsWith('https://')||!token)throw Error('R2 storage is not configured');
 const headers={Authorization:'Bearer '+token};if(mime)headers['Content-Type']=mime;
 const response=await fetch(url.replace(/\/$/,'')+'/'+key,{method,headers,body,signal:AbortSignal.timeout(30000),cache:'no-store',redirect:'error'});
 if(!response.ok){const error=new Error('R2 storage request failed');error.name=response.status===404?'ObjectNotFound':'StorageUnavailable';throw error;}
 return response;
}
export async function putObject(key,bytes,mime){keyValid(key);if(mode()==='memory'){if(process.env.NODE_ENV==='production'&&!process.env.ALLOW_MEMORY_QA)throw Error('Memory storage is for isolated tests only');memory.set(key,Uint8Array.from(bytes));return;}await bridge(key,'PUT',bytes,mime);}
export async function getObject(key){keyValid(key);if(mode()==='memory'){const value=memory.get(key);if(!value){const e=new Error('Missing object');e.name='ObjectNotFound';throw e;}return Uint8Array.from(value);}return (await bridge(key)).body;}
export async function deleteObject(key){keyValid(key);if(mode()==='memory'){memory.delete(key);return;}await bridge(key,'DELETE');}
