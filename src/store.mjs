import { mkdir, readFile, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash=text=>createHash('sha256').update(text).digest('hex');
async function directory(path) { await mkdir(path,{recursive:true,mode:0o700});await chmod(path,0o700); }
async function atomic(path,data) {
  const temporary=path+'.'+randomUUID()+'.tmp';
  try {await writeFile(temporary,data,{mode:0o600,flag:'wx'});await rename(temporary,path);}
  finally {await unlink(temporary).catch(()=>{});}
}
async function json(path) { try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;} }
export async function cachedPage(config,url,now=Date.now()) {
  const record=await json(join(config.cacheDir,'indexes',hash(url)+'.json'));
  if(!record || record.url!==url || !/^[a-f0-9]{64}$/.test(record.id) || !Number.isFinite(record.savedAt) || now-record.savedAt>3600000)return null;
  const file=join(config.cacheDir,'pages',record.id+'.md');
  try {
    const content=await readFile(file,'utf8');
    if(hash(content)!==record.id)return null;
    return {...record,url:record.finalUrl??record.url,file,cached:true};
  }catch{return null;}
}
export async function savePage(config,{requestedUrl,url,title,content}) {
  const fetchedAt=new Date().toISOString();
  const document=`# ${title.replace(/[\r\n]/g,' ')}\n\nSource: ${url}\nFetched: ${fetchedAt}\n\n${content}\n`;
  const id=hash(document),savedAt=Date.now();
  const pages=join(config.cacheDir,'pages'),indexes=join(config.cacheDir,'indexes');
  await directory(config.cacheDir);await directory(pages);await directory(indexes);
  const file=join(pages,id+'.md');
  try {await writeFile(file,document,{mode:0o600,flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  const record={id,title,url,requestedUrl,fetchedAt,savedAt,lines:document.split('\n').length-1,contentHash:hash(content),extractor:'pi-webtrail/0.1',chars:document.length};
  await atomic(join(pages,id+'.json'),JSON.stringify(record,null,2)+'\n');
  await atomic(join(indexes,hash(requestedUrl)+'.json'),JSON.stringify({...record,url:requestedUrl,finalUrl:url})+'\n');
  return {...record,file,cached:false};
}
export async function saveSearch(config,data) {
  const dir=join(config.cacheDir,'searches');await directory(config.cacheDir);await directory(dir);
  const id=randomUUID(),file=join(dir,id+'.json'),searchedAt=new Date().toISOString();
  await atomic(file,JSON.stringify({...data,searchedAt},null,2)+'\n');
  return {...data,searchedAt,file};
}
export async function pagePreview(page,maxChars) {return (await readFile(page.file,'utf8')).slice(0,maxChars);}
