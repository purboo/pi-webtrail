import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { resolveProxy } from './config.mjs';

const blocked = new BlockList();
for (const [ip, bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [['2001:db8::',32],['2001::',32],['2002::',16]]) blocked.addSubnet(ip,bits,'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
export function publicIP(ip) {
  const family = isIP(ip);
  return family === 4 ? !blocked.check(ip,'ipv4') : family === 6 && globalV6.check(ip,'ipv6') && !blocked.check(ip,'ipv6');
}
export function publicURL(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Expected an absolute public HTTP(S) URL'); }
  const host = url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal' || (isIP(host) && !publicIP(host))) {
    throw new Error('Only public HTTP(S) URLs without embedded credentials are allowed');
  }
  url.hash = '';
  return url;
}
export function deadline(signal, timeoutMs) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
}
function aborted(signal) { signal?.throwIfAborted(); }
function abortable(promise, signal) {
  if (!signal) return promise;
  aborted(signal);
  return new Promise((resolve,reject) => {
    const abort = () => reject(signal.reason ?? new Error('Request cancelled'));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
const quote = value => '"' + String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\t/g,'\\t') + '"';
export function parseResponse(bytes) {
  let start = 0, status = 0, headers;
  do {
    const end = bytes.indexOf('\r\n\r\n',start);
    if (end < 0 || end - start > 65536) throw new Error('Invalid HTTP headers');
    const lines = bytes.subarray(start,end).toString('latin1').split('\r\n');
    const match = /^HTTP\/[\d.]+\s+(\d{3})\b/.exec(lines.shift());
    if (!match) throw new Error('Invalid HTTP response');
    status = Number(match[1]); headers = {};
    for (const line of lines) {
      const split = line.indexOf(':');
      if (split > 0) headers[line.slice(0,split).toLowerCase()] = line.slice(split+1).trim();
    }
    start = end + 4;
  } while (status >= 100 && status < 200);
  return {status,headers,body:bytes.subarray(start)};
}
/** Raw transport, also used by local fixture tests. Public tools call request(). */
export async function curlRequest(url, options = {}) {
  const {signal,proxy='',resolveAddress,method='GET',body,maxBytes=2*1024*1024,timeoutMs=20000,headers={}} = options;
  aborted(signal);
  const args = ['--disable','--silent','--show-error','--include','--suppress-connect-headers','--compressed','--globoff','--proto','=http,https','--connect-timeout',String(Math.min(5,timeoutMs/1000)),'--max-time',String(timeoutMs/1000),'--max-filesize',String(maxBytes),'--user-agent','Mozilla/5.0 (compatible; pi-webtrail/0.1; +https://github.com/purboo/pi-webtrail)','--config','-'];
  if (resolveAddress) {
    const host = url.hostname.replace(/^\[|\]$/g,'');
    const address = resolveAddress.includes(':') ? `[${resolveAddress}]` : resolveAddress;
    args.push('--resolve',`${host}:${url.port || (url.protocol==='https:'?'443':'80')}:${address}`);
  }
  args.push('--request',method,'--url',url.href);
  let config = `proxy = ${quote(proxy)}\nnoproxy = ""\n`;
  for (const [key,value] of Object.entries(headers)) {
    if (!/^[a-z0-9-]+$/i.test(key) || /[\r\n\0]/.test(String(value))) throw new Error('Invalid request header');
    config += `header = ${quote(`${key}: ${value}`)}\n`;
  }
  if (body !== undefined) config += `data-binary = ${quote(body)}\n`;
  return new Promise((resolve,reject) => {
    const child = spawn('curl',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
    const chunks=[];let size=0, failure;
    const abort = () => { failure = signal.reason ?? new Error('Request cancelled'); child.kill(); };
    signal?.addEventListener('abort',abort,{once:true});
    if (signal?.aborted) abort();
    child.stdout.on('data',chunk => {
      size += chunk.length;
      if (size > maxBytes + 65536) { failure = new Error('Response exceeds the size limit'); child.kill(); }
      else chunks.push(chunk);
    });
    // Do not expose stderr: curl can include a proxy's credentials or address.
    child.stderr.on('data',() => {});
    child.stdin.on('error',() => {});
    child.on('error',error => {
      failure = error.code==='ENOENT' ? new Error('curl is required; install it and run /webtrail doctor') : new Error('Could not start curl');
    });
    child.on('close',code => {
      signal?.removeEventListener('abort',abort);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Network request failed${proxy ? ' through the selected proxy' : ''} (curl ${code})`));
      try {
        const response = parseResponse(Buffer.concat(chunks));
        if (response.body.length > maxBytes) throw new Error('Response exceeds the size limit');
        resolve(response);
      } catch (error) { reject(error); }
    });
    child.stdin.end(config);
  });
}
export async function request(input, options = {}) {
  const {config={},env=process.env,headers={},method='GET',body} = options;
  const timeoutMs=config.timeoutMs ?? 20000;
  const signal=deadline(options.signal,timeoutMs), started=Date.now();
  let url=publicURL(input);
  for (let redirects=0;redirects<=5;redirects++) {
    aborted(signal);
    const route=resolveProxy(url,config,env);
    let resolveAddress;
    if (!route.proxy && !isIP(url.hostname.replace(/^\[|\]$/g,''))) {
      const addresses=await abortable(lookup(url.hostname,{all:true}),signal);
      if (!addresses.length || addresses.some(({address})=>!publicIP(address))) throw new Error('Host resolves to a non-public address');
      resolveAddress=(addresses.find(a=>a.family===4) ?? addresses[0]).address;
    }
    const result=await curlRequest(url,{signal,proxy:route.proxy,resolveAddress,headers,method,body,maxBytes:options.maxBytes,timeoutMs:Math.max(1,timeoutMs-(Date.now()-started))});
    if ([301,302,303,307,308].includes(result.status) && result.headers.location) {
      if (redirects===5) throw new Error('Too many redirects');
      const next=publicURL(new URL(result.headers.location,url).href);
      // POST is used only for fixed search endpoints; never forward its body elsewhere.
      if (method!=='GET') throw new Error('Search endpoint redirected; request refused');
      url=next;continue;
    }
    return {...result,url:url.href,route:{source:route.source,bypassed:route.bypassed,proxied:Boolean(route.proxy)}};
  }
}
