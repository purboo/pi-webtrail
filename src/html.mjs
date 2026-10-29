const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',ndash:'–',mdash:'—',hellip:'…',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',bull:'•',copy:'©',reg:'®',trade:'™',times:'×',rarr:'→',larr:'←'};
export function decode(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match,key) => {
    if (key[0] !== '#') return entities[key] ?? match;
    const n = key[1].toLowerCase()==='x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return n>0 && n<=0x10ffff && !(n>=0xd800 && n<=0xdfff) ? String.fromCodePoint(n) : '�';
  });
}
export const clean = value => String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');
const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const ignored = new Set(['script','style','noscript','svg','iframe','canvas','template']);
function* tokens(input) {
  let position=0;const lower=input.toLowerCase();
  while(position<input.length) {
    const open=input.indexOf('<',position);
    if(open<0){yield input.slice(position);break;}
    if(open>position)yield input.slice(position,open);
    if(input.startsWith('<!--',open)) {
      const end=input.indexOf('-->',open+4);position=end<0?input.length:end+3;continue;
    }
    if(!/^<\/?[a-z!]/i.test(input.slice(open,open+4))){yield '<';position=open+1;continue;}
    let end=open+1,quote='';
    for(;end<input.length;end++) {
      const char=input[end];
      if(quote){if(char===quote)quote='';}
      else if(char==='"' || char==="'")quote=char;
      else if(char==='>')break;
    }
    if(end===input.length){yield input.slice(open);break;}
    const raw=input.slice(open,end+1);yield raw;position=end+1;
    const rawText=/^<(script|style|noscript|template)\b/i.exec(raw);
    if(rawText && !raw.endsWith('/>')) {
      const closing=lower.indexOf(`</${rawText[1].toLowerCase()}`,position);
      position=closing<0?input.length:closing;
    }
  }
}
/** Small inert HTML tree. It never executes scripts or fetches subresources. */
export function parseHTML(input) {
  const root={tag:'root',attrs:{},children:[]};let current=root,nodes=0;
  for (const raw of tokens(input)) {
    if (raw.startsWith('<!')) continue;
    if (!raw.startsWith('<') || raw==='<') { current.children.push(decode(raw));continue; }
    const tag=/^<\/?([a-z0-9:-]+)/i.exec(raw)?.[1].toLowerCase();
    if (!tag) continue;
    if (raw.startsWith('</')) {
      let cursor=current;
      while (cursor!==root && cursor.tag!==tag) cursor=cursor.parent;
      if (cursor!==root) current=cursor.parent;
      continue;
    }
    if (['p','li','tr','td','th'].includes(tag) && current.tag===tag) current=current.parent;
    const attrs={};
    for (const attr of raw.slice(tag.length+1,-1).matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1].toLowerCase()]=decode(attr[2]??attr[3]??attr[4]??'');
    if(++nodes>50000)throw new Error('Page is too complex to parse');
    const node={tag,attrs,children:[],parent:current};current.children.push(node);
    if (!voids.has(tag) && !raw.endsWith('/>')) {
      let depth=0;for(let n=current;n && depth<256;n=n.parent)depth++;
      if (depth<256) current=node;
    }
  }
  return root;
}
export function all(node,predicate) {
  const found=[],stack=[node];
  while(stack.length) { const n=stack.pop();if(typeof n==='string')continue;if(predicate(n))found.push(n);for(let i=n.children.length-1;i>=0;i--)stack.push(n.children[i]); }
  return found;
}
export const hasClass=(node,name)=>(node.attrs.class??'').split(/\s+/).includes(name);
export function text(node) { return typeof node==='string' ? node : ignored.has(node.tag) ? '' : node.children.map(text).join(''); }
export const compact=node=>clean(text(node)).replace(/\s+/g,' ').trim();
export function linkURL(value,base) {
  if(typeof value!=='string' || !value.trim())return null;
  try { const url=new URL(value,base);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function codeFence(raw,minimum=1) {
  let length=minimum;
  for(const run of raw.matchAll(/`+/g))length=Math.max(length,run[0].length+1);
  return '`'.repeat(length);
}
function markdown(node,base) {
  if(typeof node==='string')return clean(node).replace(/\s+/g,' ').replace(/([\\`*_[\]])/g,'\\$1');
  const {tag,attrs}=node;
  if(ignored.has(tag) || ['nav','header','footer','aside','form','button','input'].includes(tag) || attrs['aria-hidden']==='true' || Object.hasOwn(attrs,'hidden'))return '';
  if(tag==='pre') {
    const raw=clean(text(node)).replace(/^\n|\n$/g,'');
    const fence=codeFence(raw,3);
    return `\n\n${fence}\n${raw}\n${fence}\n\n`;
  }
  if(tag==='code') {
    const raw=clean(text(node)).replace(/\r\n?|\n/g,' ');
    if(!raw)return '';
    const fence=codeFence(raw);
    // CommonMark strips one boundary space only when both ends have spaces
    // and the content is not all spaces. Padding also separates literal ticks.
    const pad=raw.startsWith('`') || raw.endsWith('`') || (raw.startsWith(' ') && raw.endsWith(' ') && /[^ ]/.test(raw)) ? ' ' : '';
    return fence+pad+raw+pad+fence;
  }
  const inner=node.children.map(n=>markdown(n,base)).join('');
  if(/^h[1-6]$/.test(tag))return `\n\n${'#'.repeat(Number(tag[1]))} ${inner.trim()}\n\n`;
  if(tag==='br')return '\n';
  if(tag==='hr')return '\n\n---\n\n';
  if(tag==='a') { const url=linkURL(attrs.href??'',base);return url && attrs.href ? `[${inner.trim()||url}](${url.replace(/\(/g,'%28').replace(/\)/g,'%29')})` : inner; }
  if(tag==='img')return attrs.alt ? ` [Image: ${clean(attrs.alt)}] ` : '';
  if(tag==='strong' || tag==='b')return `**${inner.trim()}**`;
  if(tag==='em' || tag==='i')return `*${inner.trim()}*`;
  if(tag==='li')return `\n- ${inner.trim()}\n`;
  if(tag==='td' || tag==='th')return ` ${inner.trim().replace(/\|/g,'\\|')} |`;
  if(tag==='tr')return `\n|${inner}\n`;
  if(['p','div','section','article','main','blockquote','ul','ol','table','dl','dt','dd'].includes(tag))return `\n\n${inner.trim()}\n\n`;
  return inner;
}
export function extractPage(html,url) {
  const root=parseHTML(html);
  const title=compact(all(root,n=>n.tag==='title')[0]??root).slice(0,250)||new URL(url).hostname;
  const candidates=all(root,n=>n.tag==='main' || n.tag==='article' || n.attrs.role==='main');
  const chosen=candidates.sort((a,b)=>text(b).length-text(a).length)[0] ?? all(root,n=>n.tag==='body')[0] ?? root;
  let fence=0,blanks=0;
  const content=markdown(chosen,url).split('\n').filter(line=>{
    const marker=/^(`{3,})\s*$/.exec(line);
    if(marker){if(!fence)fence=marker[1].length;else if(marker[1].length>=fence)fence=0;blanks=0;return true;}
    if(fence)return true;
    if(line.trim()){blanks=0;return true;}
    return ++blanks<=1;
  }).join('\n').trim();
  if(!content)throw new Error('Page has no readable text; it may require JavaScript');
  return {title,content};
}
export function parseSearch(html,engine,limit=5) {
  const results=[],seen=new Set();
  const add=(title,url,snippet='')=>{if(!url || !title || seen.has(url))return;seen.add(url);results.push({title:clean(title).slice(0,250),url,snippet:clean(snippet).replace(/\s+/g,' ').trim().slice(0,500)});};
  if(engine==='bing') {
    for(const match of html.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
      const field=name=>decode((new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,'i').exec(match[1])?.[1]??'').replace(/^<!\[CDATA\[|\]\]>$/g,''));
      add(compact(parseHTML(field('title'))),linkURL(field('link'),'https://www.bing.com'),compact(parseHTML(field('description'))));
    }
  } else {
    const root=parseHTML(html);
    if(engine==='duckduckgo')for(const node of all(root,n=>hasClass(n,'result') && !hasClass(n,'result--ad'))) {
      const anchor=all(node,n=>n.tag==='a' && hasClass(n,'result__a'))[0];if(!anchor)continue;
      let url=linkURL(anchor.attrs.href,'https://html.duckduckgo.com');
      if(url)url=new URL(url).searchParams.get('uddg')??url;
      add(compact(anchor),linkURL(url,'https://html.duckduckgo.com'),compact(all(node,n=>hasClass(n,'result__snippet'))[0]??{tag:'root',children:[]}));
    }
    if(engine==='google')for(const heading of all(root,n=>n.tag==='h3')) {
      let anchor=heading.parent;while(anchor && anchor.tag!=='a')anchor=anchor.parent;
      if(!anchor)continue;
      let url=linkURL(anchor.attrs.href,'https://www.google.com');
      if(url) {const parsed=new URL(url);if(parsed.hostname==='www.google.com' && parsed.pathname==='/url')url=parsed.searchParams.get('q')??parsed.searchParams.get('url');}
      url=linkURL(url,'https://www.google.com');
      if(url && /(^|\.)google\.com$/.test(new URL(url).hostname))continue;
      add(compact(heading),linkURL(url,'https://www.google.com'),compact(anchor.parent??anchor));
    }
  }
  return results.slice(0,limit);
}
export function blockedSearch(html,engine) {
  if(engine==='google') {
    if(/unusual traffic|our systems have detected|id=["']captcha|\/sorry\/index/i.test(html))return 'Google requires a CAPTCHA on this network; use another engine or a different trusted proxy';
    if(/enablejs|enable javascript|javascript is disabled/i.test(html))return 'Google requires JavaScript; configure browserPath to use an existing Chromium browser';
    if(/consent\.google\.com\/|before you continue to google/i.test(html))return 'Google requires browser consent';
  }
  if(engine==='duckduckgo' && /anomaly-modal|id=["']challenge-form/i.test(html))return 'DuckDuckGo returned a bot challenge; try another engine later';
  return null;
}
