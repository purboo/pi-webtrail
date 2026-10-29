import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProxy } from './config.mjs';
import { deadline } from './net.mjs';

/** Optional Google-only renderer. Uses an installed Chromium, no driver/SDK. */
export async function renderGoogle(url, {config,env=process.env,signal}) {
  signal=deadline(signal,config.timeoutMs);
  signal.throwIfAborted();
  const route=resolveProxy(new URL(url),config,env);
  let proxy=route.proxy;
  if(proxy) {
    const parsed=new URL(proxy);
    if(parsed.username || parsed.password) throw new Error('Chromium proxy authentication is unsupported; use a local proxy without credentials');
    // Chromium resolves SOCKS5 target names remotely. socks5h is curl's spelling.
    if(parsed.protocol==='socks5h:')parsed.protocol='socks5:';
    proxy=parsed.href;
  }
  const profile=await mkdtemp(join(tmpdir(),'pi-webtrail-browser-'));
  try {
    return await new Promise((resolve,reject)=>{
      const args=['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-sync',`--user-data-dir=${profile}`,'--virtual-time-budget=5000','--dump-dom',...(proxy?[`--proxy-server=${proxy}`,'--proxy-bypass-list=<-loopback>']:['--no-proxy-server']),url];
      const child=spawn(config.browserPath,args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32',windowsHide:true});
      let failure,size=0;const chunks=[];
      const stop=()=>{
        try {if(process.platform!=='win32' && child.pid)process.kill(-child.pid,'SIGTERM');else child.kill();}catch{}
      };
      const abort=()=>{failure=signal.reason??new Error('Browser request cancelled');stop();};
      signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){failure=new Error('Browser response exceeds the size limit');stop();}else chunks.push(chunk);});
      child.stderr.on('data',()=>{});
      child.on('error',()=>{failure=new Error('Could not start browserPath; use an installed Chromium executable');});
      child.on('close',code=>{
        signal.removeEventListener('abort',abort);stop();
        if(failure)return reject(failure);
        if(code!==0)return reject(new Error('Chromium could not render Google Search'));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
  } finally { await rm(profile,{recursive:true,force:true,maxRetries:2,retryDelay:100}).catch(()=>{}); }
}
