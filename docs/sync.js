export const API_ORIGIN='https://kaede-meal-calendar.djkj5fx4bm.chatgpt.site';
export const validKey=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{43}$/.test(value);
export function randomKey(){return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
export class SyncError extends Error{constructor(message,status=0){super(message);this.status=status;}}
export class SyncAPI{
 constructor(key,deviceKey){this.key=key;this.deviceKey=deviceKey;}
 async call(path,{method='GET',data,version}={}){const headers={'X-Device-Key':this.deviceKey};if(this.key)headers.Authorization='Bearer '+this.key;if(data!==undefined)headers['Content-Type']='application/json';if(version)headers['If-Match']=String(version);let response;try{response=await fetch(API_ORIGIN+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(15000)});}catch{throw new SyncError('接続できません。通信を確認して再試行してください。入力は残っています。');}let result;try{result=await response.json();}catch{throw new SyncError('応答を読み込めません。少し待って再試行してください。',response.status);}if(!response.ok)throw new SyncError(result.error||'保存できませんでした。再試行してください。',response.status);return result;}
 list(month){return this.call('/api/entries?month='+encodeURIComponent(month));}
 create(name){return this.call('/api/calendars',{method:'POST',data:{name}});}
 registerName(name){return this.call('/api/device',{method:'POST',data:{name}});}
 save(entry,expectedVersion){return this.call('/api/entries/'+encodeURIComponent(entry.id),{method:'PUT',data:{entry,expectedVersion}});}
 remove(id,version){return this.call('/api/entries/'+encodeURIComponent(id),{method:'DELETE',version});}
 import(entries){return this.call('/api/import',{method:'POST',data:{entries}});}
}
