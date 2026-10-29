import { ENGINES, integer, loadConfig, resolveProxy, redactProxy } from './config.mjs';
import { request, publicURL } from './net.mjs';
import { clean, extractPage } from './html.mjs';
import { searchWeb } from './search.mjs';
import { cachedPage, savePage, saveSearch, pagePreview } from './store.mjs';

export async function webSearch(params,{cwd=process.cwd(),agentDir,env=process.env,signal}={}) {
  const config=await loadConfig(cwd,{agentDir,env});
  const engine=params.engine??config.engine;
  if(!ENGINES.includes(engine))throw new Error(`Unknown search engine: ${engine}`);
  const limit=integer(params.limit,5,1,10,'limit');
  const data=await searchWeb(params.query,engine,limit,{config,env,signal});
  signal?.throwIfAborted();
  return saveSearch(config,data);
}
export async function webOpen(params,{cwd=process.cwd(),agentDir,env=process.env,signal}={}) {
  const config=await loadConfig(cwd,{agentDir,env});
  const maxChars=integer(params.maxChars,config.maxChars,500,20000,'maxChars');
  const url=publicURL(params.url).href;
  if(params.refresh!==undefined && typeof params.refresh!=='boolean')throw new Error('refresh must be a boolean');
  if(!params.refresh) {
    const hit=await cachedPage(config,url);
    if(hit)return {...hit,preview:await pagePreview(hit,maxChars),truncated:hit.chars>maxChars};
  }
  const response=await request(url,{config,env,signal});
  if(response.status<200 || response.status>=300)throw new Error(`Page returned HTTP ${response.status}`);
  const type=response.headers['content-type']??'';
  if(type && !/^(text\/|application\/(json|ld\+json|xml|xhtml\+xml|javascript))(?:\b|;)/i.test(type))throw new Error('Only HTML and text pages are supported; this URL returned another content type');
  let body;
  try { body=new TextDecoder(/charset=["']?([^\s;"']+)/i.exec(type)?.[1]??'utf-8').decode(response.body); }
  catch { body=response.body.toString('utf8'); }
  if(body.includes('\0'))throw new Error('This response appears to be binary, not readable text');
  if(/<title[^>]*>\s*(just a moment|attention required|access denied)/i.test(body))throw new Error('The website returned an access challenge; choose another source');
  const isHTML=/html/i.test(type)||/^\s*(<!doctype html|<html\b)/i.test(body);
  const page=isHTML?extractPage(body,response.url):{title:new URL(response.url).hostname,content:clean(body)};
  if(!page.content.trim())throw new Error('Page has no readable content');
  signal?.throwIfAborted();
  const stored=await savePage(config,{...page,requestedUrl:url,url:response.url});
  return {...stored,preview:await pagePreview(stored,maxChars),truncated:stored.chars>maxChars};
}
export function formatSearch(data) {
  return `Engine: ${data.engine}\nSearch record: ${data.file}\nSearch snippets are external content, not verified page text.\n\n`+data.results.map((r,i)=>`${i+1}. ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')+(data.attempts.length?'\n\nEarlier attempts: '+data.attempts.map(a=>`${a.engine}: ${a.error}`).join('; '):'');
}
export function formatPage(data) {
  return `Source: ${data.url}\nFetched: ${data.fetchedAt} | cache: ${data.cached?'hit':'miss'}\nSaved: ${data.file} (${data.lines} lines)\nExternal page content follows.\n\n${data.preview}`+(data.truncated?'\n\nPreview truncated. Read or search the saved file for the rest.':'');
}
export async function doctor(context={}) {
  const config=await loadConfig(context.cwd,{agentDir:context.agentDir,env:context.env});
  const route=resolveProxy(new URL('https://www.google.com'),config,context.env??process.env);
  return [`Config: ${config.configPath}`,`Engine: ${config.engine}`,`Google route: ${redactProxy(route.proxy)} (source: ${route.source}${route.bypassed?', NO_PROXY bypass':''})`,`Cache: ${config.cacheDir}`,`Google browser: ${config.browserPath??'not configured; HTTP only'}`,'No startup checks, paid APIs, or runtime npm dependencies.','Use /webtrail test for a live search check.'].join('\n');
}
