import { request, deadline } from './net.mjs';
import { parseSearch, blockedSearch, clean } from './html.mjs';
import { renderGoogle } from './browser.mjs';

export function exaResults(body,limit=5) {
  let rpc;
  try { rpc=JSON.parse(body); } catch {
    for(const line of body.split('\n'))if(line.startsWith('data:')) {
      try { const value=JSON.parse(line.slice(5).trim());if(value.result || value.error){rpc=value;break;} }catch{}
    }
  }
  if(!rpc)throw new Error('Exa returned an unparseable response');
  const result=rpc.result;
  const content=(result?.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join('\n\n');
  if(result?._meta?.['ai.exa/rateLimited'] || ((rpc.error || result?.isError || !/^URL:\s*https?:/m.test(content)) && /rate.?limit|quota|429/i.test(content+' '+(rpc.error?.message??''))))throw new Error('Exa free service is rate-limited; try a different engine later');
  if(rpc.error || result?.isError)throw new Error('Exa service returned an error');
  const matches=[...content.matchAll(/^Title:\s*(.+)\r?\nURL:\s*(https?:\/\/\S+)/gm)],results=[];
  for(let i=0;i<matches.length;i++) {
    const match=matches[i];let url;
    try { url=new URL(match[2]);if(!['http:','https:'].includes(url.protocol) || url.username || url.password)continue; }catch{continue;}
    const excerpt=content.slice(match.index+match[0].length,matches[i+1]?.index??content.length).replace(/^\s*(Published|Author):.*$/gm,'').replace(/^\s*(Text|Highlights):\s*/m,'').trim();
    if(!results.some(r=>r.url===url.href))results.push({title:clean(match[1]).slice(0,250),url:url.href,snippet:clean(excerpt).replace(/\s+/g,' ').slice(0,500)});
  }
  if(!results.length)throw new Error('Exa returned no parseable search results');
  return results.slice(0,limit);
}
export async function searchWeb(query,engine,limit,{config,env=process.env,signal}) {
  if(typeof query!=='string' || !query.trim() || query.length>2000)throw new Error('query must contain 1–2000 characters');
  signal=deadline(signal,config.timeoutMs);
  const attempts=[];
  for(const selected of engine==='auto'?['duckduckgo','bing']:[engine]) {
    signal.throwIfAborted();
    try {
      let results;
      if(selected==='exa') {
        const response=await request('https://mcp.exa.ai/mcp?tools=web_search_exa',{config,env,signal,method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'web_search_exa',arguments:{query,numResults:limit}}})});
        if(response.status===429)throw new Error('Exa free service is rate-limited; try a different engine later');
        if(response.status!==200)throw new Error(`Exa returned HTTP ${response.status}`);
        results=exaResults(response.body.toString('utf8'),limit);
      } else {
        const url=selected==='google'?new URL('https://www.google.com/search'):selected==='bing'?new URL('https://www.bing.com/search'):new URL('https://html.duckduckgo.com/html/');
        url.searchParams.set('q',query);
        if(selected==='google'){url.searchParams.set('udm','14');url.searchParams.set('hl','en');}
        if(selected==='bing')url.searchParams.set('format','rss');
        const response=await request(url.href,{config,env,signal});
        if(response.status!==200 && response.status!==202)throw new Error(`${selected} returned HTTP ${response.status}`);
        let html=response.body.toString('utf8'),blocked=blockedSearch(html,selected);
        if(selected==='google' && blocked?.includes('JavaScript') && config.browserPath) {
          html=await renderGoogle(url.href,{config,env,signal});blocked=blockedSearch(html,selected);
        }
        if(blocked)throw new Error(blocked);
        results=parseSearch(html,selected,limit);
        if(!results.length)throw new Error(`${selected} returned no parseable results; it may be blocked or its layout may have changed`);
      }
      return {query,engine:selected,results,attempts};
    } catch(error) {
      signal.throwIfAborted();
      if(engine!=='auto')throw error;
      attempts.push({engine:selected,error:error.message});
    }
  }
  throw new Error('Search failed: '+attempts.map(a=>`${a.engine}: ${a.error}`).join('; '));
}
