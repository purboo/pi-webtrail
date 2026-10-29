import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { connect, createServer as createTCPServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveProxy, redactProxy } from '../src/config.mjs';
import { request, curlRequest, publicURL, publicIP } from '../src/net.mjs';
import { extractPage, parseSearch, blockedSearch, decode, linkURL, parseHTML } from '../src/html.mjs';
import { exaResults } from '../src/search.mjs';
import { savePage, cachedPage, pagePreview } from '../src/store.mjs';
import { webSearch, webOpen, formatSearch, doctor } from '../src/core.mjs';

async function temporary(t) {
  const path=await mkdtemp(join(tmpdir(),'webtrail-test-'));
  t.after(()=>rm(path,{recursive:true,force:true}));return path;
}
async function server(t,handler) {
  const http=createServer(handler);
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{http.closeAllConnections();http.close(resolve);}));
  return `http://127.0.0.1:${http.address().port}`;
}
// These public test-only keys let curl verify TLS through a real CONNECT tunnel.
// No external DNS, internet connection or insecure TLS flags are used.
async function tlsProxy(t,handler) {
  const certPath=fileURLToPath(new URL('./fixtures/tls-cert.pem',import.meta.url));
  const origin=createSecureServer({cert:await readFile(certPath),key:await readFile(new URL('./fixtures/tls-key.pem',import.meta.url))},handler);
  await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));
  const proxy=createServer();const sockets=new Set();
  proxy.on('connect',(_req,client,head)=>{
    const upstream=connect(origin.address().port,'127.0.0.1');sockets.add(client);sockets.add(upstream);
    upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());
    upstream.on('connect',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const previous=process.env.CURL_CA_BUNDLE;process.env.CURL_CA_BUNDLE=certPath;
  t.after(async()=>{
    if(previous===undefined)delete process.env.CURL_CA_BUNDLE;else process.env.CURL_CA_BUNDLE=previous;
    for(const socket of sockets)socket.destroy();
    await Promise.all([new Promise(resolve=>{origin.closeAllConnections();origin.close(resolve);}),new Promise(resolve=>proxy.close(resolve))]);
  });
  return `http://127.0.0.1:${proxy.address().port}`;
}
const ddg='<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2Fdocs%2F">TypeScript &amp; docs</a><div class="result__snippet">Official <b>documentation</b>.</div></div>';

test('proxy priority, explicit direct, NO_PROXY domain boundaries and ports',()=>{
  const target=new URL('https://docs.example.com');
  assert.equal(resolveProxy(target,{}, {HTTPS_PROXY:'http://proxy.test:8888'}).proxy,'http://proxy.test:8888/');
  assert.equal(resolveProxy(target,{proxy:''}, {HTTPS_PROXY:'http://proxy.test:8888'}).proxy,'');
  assert.equal(resolveProxy(target,{proxy:'http://other.test'}, {PI_WEBTRAIL_PROXY:'socks5h://localhost:20172'}).proxy,'socks5h://localhost:20172');
  assert.equal(resolveProxy(target,{proxy:'http://proxy.test'}, {NO_PROXY:'.example.com:443'}).bypassed,true);
  assert.equal(resolveProxy(target,{proxy:'http://proxy.test'}, {NO_PROXY:'ample.com,example.com:80'}).bypassed,false);
  assert.equal(resolveProxy(new URL('https://[2001:4860:4860::8888]/'),{proxy:'http://proxy.test'},{NO_PROXY:'[2001:4860:4860::8888]:443'}).bypassed,true);
  assert.throws(()=>resolveProxy(target,{}, {PI_WEBTRAIL_PROXY:'not-a-proxy'}),/Invalid proxy/);
  assert.throws(()=>resolveProxy(target,{proxy:'http://user:secret@proxy.test/path'},{}),/no path/);
  assert.doesNotMatch(redactProxy('http://user:secret@proxy.test:8'),/user|secret/);
});

test('config fails clearly on typos and invalid values without leaking credentials',async t=>{
  const dir=await temporary(t);
  await writeFile(join(dir,'webtrail.json'),JSON.stringify({engine:'duckduckgo',proxy:'http://localhost:20172'}));
  const config=await loadConfig(dir,{agentDir:dir,env:{}});assert.equal(config.engine,'duckduckgo');
  await writeFile(join(dir,'webtrail.json'),'{"proxy":"SECRET",');
  await assert.rejects(loadConfig(dir,{agentDir:dir,env:{}}),e=>!e.message.includes('SECRET'));
  await writeFile(join(dir,'webtrail.json'),'{"maxChars":-1}');
  await assert.rejects(loadConfig(dir,{agentDir:dir,env:{}}),/maxChars/);
  await writeFile(join(dir,'webtrail.json'),'{"proyx":"x"}');
  await assert.rejects(loadConfig(dir,{agentDir:dir,env:{}}),/Unknown/);
});

test('public URL guard rejects private, encoded loopback, credentials and IPv6 special ranges',()=>{
  for(const input of ['file:///etc/passwd','http://localhost/','http://localhost./','http://metadata.google.internal./','http://127.0.0.1/','http://0x7f000001/','http://2130706433/','http://[::1]/','http://[::ffff:127.0.0.1]/','http://169.254.169.254/','https://user:password@example.com/'])assert.throws(()=>publicURL(input));
  assert.equal(publicIP('8.8.8.8'),true);assert.equal(publicIP('2001:4860:4860::8888'),true);
  for(const ip of ['10.0.0.1','100.64.0.1','198.18.0.1','2001:db8::1','2002:7f00:1::','fc00::1','::ffff:8.8.8.8'])assert.equal(publicIP(ip),false,ip);
});

test('inert extraction keeps code, links, entities and main content without scripts/navigation',()=>{
  const html='<html><head><title>API &amp; Examples</title></head><body><nav>NOISE</nav><main><h1>Guide</h1><p>Use <a href="/v2">v2</a> &lt;now&gt;.</p><script>const n = 1<value; DANGER()</script><pre><code>line 1\n\n\n  line 2 &lt; 3\n```\n\n\nlast</code></pre><p hidden>HIDDEN</p></main><footer>FOOTER</footer></body></html>';
  const page=extractPage(html,'https://example.com/docs');
  assert.equal(page.title,'API & Examples');assert.match(page.content,/\[v2\]\(https:\/\/example.com\/v2\)/);
  assert.match(page.content,/line 1\n\n\n  line 2 < 3/);
  assert.match(page.content,/```\n\n\nlast/);assert.doesNotMatch(page.content,/NOISE|DANGER|HIDDEN|FOOTER/);
  assert.equal(decode('&#x1f600; &#169; &amp;'),'😀 © &');
  assert.equal(linkURL(null,'https://example.com'),null);
  assert.equal(linkURL('javascript:alert(1)','https://example.com'),null);
  assert.doesNotThrow(()=>parseHTML('<main title="'+ 'x'.repeat(100000)));
});

test('inline technical code preserves punctuation, paths, backticks and boundary spaces',()=>{
  const examples=[
    ['my_var','`my_var`'],
    ['arr[0]','`arr[0]`'],
    [String.raw`C:\Users\name`,'`C:\\Users\\name`'],
    ['**bold**','`**bold**`'],
    ['a`b','``a`b``'],
    ['`','`` ` ``'],
    ['foo``bar','```foo``bar```'],
    [' both spaces ','`  both spaces  `'],
    [' leading','` leading`'],
    ['   ','`   `'],
    ['line\nbreak','`line break`'],
    ['&lt;a&gt;','`<a>`'],
  ];
  for(const [html,expected] of examples)assert.equal(extractPage(`<main><code>${html}</code></main>`,'https://example.com').content,expected,html);
  assert.equal(extractPage('<main><code>my_var</code> <code>arr[0]</code></main>','https://example.com').content,'`my_var` `arr[0]`');
});

test('search parsers return actual source URLs, omit ads and identify challenge pages',()=>{
  const results=parseSearch(ddg,'duckduckgo');
  assert.equal(results[0].url,'https://www.typescriptlang.org/docs/');assert.equal(results[0].snippet,'Official documentation.');
  assert.equal(parseSearch(ddg.replace('class="result"','class="result result--ad"'),'duckduckgo').length,0);
  assert.equal(parseSearch('<rss><channel><item><title>Docs</title><link>https://example.com/docs</link><description>Read &amp; learn</description></item></channel></rss>','bing')[0].snippet,'Read & learn');
  assert.equal(parseSearch('<div><a href="/url?q=https%3A%2F%2Fexample.com"><h3>Example</h3></a></div>','google')[0].url,'https://example.com/');
  assert.match(blockedSearch('<div id="challenge-form">','duckduckgo'),/challenge/);
  assert.match(blockedSearch('<html>unusual traffic</html>','google'),/CAPTCHA/);
  assert.match(blockedSearch('<noscript>enablejs</noscript>','google'),/JavaScript/);
});

test('Exa handles SSE, source deduplication and HTTP-200 free quota errors',()=>{
  const rpc={jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'Title: Docs\nURL: https://example.com/docs\nPublished: N/A\nAuthor: N/A\nHighlights:\nHelpful excerpt.'}]}};
  const results=exaResults('event: message\ndata: '+JSON.stringify(rpc)+'\n\n');assert.equal(results[0].snippet,'Helpful excerpt.');
  assert.throws(()=>exaResults(JSON.stringify({result:{_meta:{'ai.exa/rateLimited':true},content:[]}})),/rate-limited/);
  assert.throws(()=>exaResults(JSON.stringify({result:{content:[{type:'text',text:"You've hit Exa's free MCP rate limit."}]}})),/rate-limited/);
  assert.throws(()=>exaResults('not-json'),/unparseable/);
});

test('curl proxy routing is local to each call, carries request bodies, and never patches fetch',async t=>{
  const calls=[];
  const proxy=await server(t,async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    calls.push({url:req.url,body,method:req.method});res.end('proxied');
  });
  const originalFetch=globalThis.fetch;
  const response=await request('http://origin.invalid/resource',{config:{proxy,timeoutMs:3000},env:{},method:'POST',body:'{"query":"hello"}'});
  assert.equal(response.body.toString(),'proxied');assert.equal(calls[0].url,'http://origin.invalid/resource');assert.equal(calls[0].body,'{"query":"hello"}');
  assert.equal(globalThis.fetch,originalFetch);
  await assert.rejects(request('http://origin.invalid/resource',{config:{proxy:'http://127.0.0.1:1',timeoutMs:1000},env:{}}),/selected proxy/);
  assert.equal(calls.length,1);
});

test('SOCKS5H sends the target hostname to the proxy without local DNS',async t=>{
  const origin=await server(t,(_req,res)=>res.end('remote DNS works'));
  const sockets=new Set();let target;
  const socks=createTCPServer(client=>{
    sockets.add(client);let buffer=Buffer.alloc(0),state=0;
    const receive=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      if(state===0){if(buffer.length<2 || buffer.length<2+buffer[1])return;buffer=buffer.subarray(2+buffer[1]);client.write(Buffer.from([5,0]));state=1;}
      if(state===1){
        if(buffer.length<5)return;
        assert.equal(buffer[3],3);const length=buffer[4];if(buffer.length<7+length)return;
        target=buffer.subarray(5,5+length).toString();const remaining=buffer.subarray(7+length);state=2;client.off('data',receive);
        const upstream=connect(Number(new URL(origin).port),'127.0.0.1');sockets.add(upstream);
        upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());
        upstream.on('connect',()=>{client.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));if(remaining.length)upstream.write(remaining);client.pipe(upstream);upstream.pipe(client);});
      }
    };
    client.on('data',receive);
  });
  await new Promise(resolve=>socks.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();socks.close(resolve);}));
  const response=await request('http://origin.invalid/docs',{config:{proxy:`socks5h://127.0.0.1:${socks.address().port}`,timeoutMs:3000},env:{}});
  assert.equal(response.body.toString(),'remote DNS works');assert.equal(target,'origin.invalid');
});

test('NO_PROXY actually bypasses an available proxy instead of silently using it',async t=>{
  let calls=0;
  const proxy=await server(t,(_req,res)=>{calls++;res.end('wrong path');});
  await assert.rejects(request('http://origin.invalid/resource',{config:{proxy,timeoutMs:1000},env:{NO_PROXY:'origin.invalid'}}));
  assert.equal(calls,0);
});

test('manual redirects validate every target before another network request',async t=>{
  let calls=0;
  const proxy=await server(t,(_req,res)=>{calls++;res.writeHead(302,{Location:'http://127.0.0.1/private'});res.end();});
  await assert.rejects(request('http://public.invalid/page',{config:{proxy,timeoutMs:1000},env:{}}),/public HTTP/);
  assert.equal(calls,1);
});

test('cancellation terminates curl and does not wait for the server response',async t=>{
  let received;
  const started=new Promise(resolve=>received=resolve);
  const proxy=await server(t,()=>received());
  const controller=new AbortController();
  const pending=request('http://origin.invalid/',{config:{proxy,timeoutMs:10000},env:{},signal:controller.signal});
  await started;controller.abort(new Error('test cancelled'));
  await assert.rejects(pending,/test cancelled/);
});

test('transport enforces decoded output limits',async t=>{
  const origin=await server(t,(_req,res)=>res.end('x'.repeat(5000)));
  await assert.rejects(curlRequest(new URL(origin),{maxBytes:100,timeoutMs:2000}),/size limit|curl 63/);
});

test('snapshots are immutable, readable after reload, validate hashes, and retain old citations',async t=>{
  const cacheDir=await temporary(t),config={cacheDir};
  const page=await savePage(config,{requestedUrl:'https://example.com',url:'https://example.com/final',title:'Example',content:'Original text'});
  const hit=await cachedPage(config,'https://example.com');assert.equal(hit.file,page.file);assert.equal(hit.cached,true);assert.equal(hit.url,'https://example.com/final');
  assert.match(await pagePreview(hit,500),/Original text/);
  const newer=await savePage(config,{requestedUrl:'https://example.com',url:'https://example.com/final',title:'Example',content:'Updated text'});
  assert.notEqual(newer.file,page.file);assert.match(await readFile(page.file,'utf8'),/Original text/);
  assert.equal(await cachedPage(config,'https://example.com',Date.now()+3600001),null);
  await writeFile(newer.file,'tampered');assert.equal(await cachedPage(config,'https://example.com'),null);
  if(process.platform!=='win32')assert.equal((await stat(page.file)).mode&0o777,0o600);
});

test('end-to-end search and open use configured proxy, retain bounded previews and reuse disk cache',async t=>{
  const dir=await temporary(t);let pages=0;
  const proxy=await tlsProxy(t,(req,res)=>{
    if(req.headers.host.includes('duckduckgo')){res.setHeader('Content-Type','text/html');res.end(ddg);}
    else {pages++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<html><title>Reference</title><main><h1>API</h1><p>'+ 'Documentation. '.repeat(400)+'</p></main></html>');}
  });
  await writeFile(join(dir,'webtrail.json'),JSON.stringify({proxy,cacheDir:join(dir,'cache')}));
  const context={cwd:dir,agentDir:dir,env:{}};
  const found=await webSearch({query:'docs'},context);assert.equal(found.engine,'duckduckgo');assert.equal(found.results.length,1);
  assert.match(formatSearch(found),/Search record:/);
  const page=await webOpen({url:'https://www.typescriptlang.org/docs/',maxChars:500},context);
  assert.equal(page.preview.length,500);assert.equal(page.truncated,true);
  const cached=await webOpen({url:'https://www.typescriptlang.org/docs/'},context);
  assert.equal(cached.cached,true);assert.equal(pages,1);
  await webOpen({url:'https://www.typescriptlang.org/docs/',refresh:true},context);assert.equal(pages,2);
  assert.match(await doctor(context),/Google route:/);
});

test('explicit Google errors remain Google errors and never become another engine',async t=>{
  const dir=await temporary(t);let requests=0;
  const proxy=await tlsProxy(t,(_req,res)=>{requests++;res.end('<html>unusual traffic</html>');});
  await writeFile(join(dir,'webtrail.json'),JSON.stringify({proxy,cacheDir:join(dir,'cache')}));
  await assert.rejects(webSearch({query:'docs',engine:'google'},{cwd:dir,agentDir:dir,env:{}}),/CAPTCHA/);
  assert.equal(requests,1);
});
