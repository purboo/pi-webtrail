import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';

export const ENGINES = ['auto', 'duckduckgo', 'bing', 'google', 'exa'];
export const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export function integer(value, fallback, min, max, label) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return value;
}
export function normalizeProxy(value) {
  if (typeof value !== 'string') throw new Error('Proxy must be a URL string; use an empty string for direct requests');
  if (!value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Invalid proxy URL'); }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || /[\r\n\0]/.test(value)) {
    throw new Error('Proxy must use http://, https://, socks5://, or socks5h:// with no path or query');
  }
  return url.href;
}
export function redactProxy(value) {
  if (!value) return 'direct';
  const url = new URL(value);
  if (url.username) url.username = '***';
  if (url.password) url.password = '***';
  return url.href;
}
export function bypassProxy(url, value = '') {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return value.split(',').some(raw => {
    let entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry === '*') return true;
    const parts = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(entry);
    if (parts) {
      if (parts[2] && parts[2] !== port) return false;
      entry = parts[1].replace(/^\[|\]$/g, '');
    }
    entry = entry.replace(/^\*?\./, '');
    return hostname === entry || (!isIP(hostname) && hostname.endsWith(`.${entry}`));
  });
}
export function resolveProxy(url, config, env = process.env) {
  let value, source = 'none';
  if (own(env, 'PI_WEBTRAIL_PROXY')) { value = env.PI_WEBTRAIL_PROXY; source = 'PI_WEBTRAIL_PROXY'; }
  else if (own(config, 'proxy')) { value = config.proxy; source = 'webtrail.json'; }
  else {
    const keys = url.protocol === 'https:' ? ['https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'] : ['http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY'];
    for (const key of keys) if (env[key]) { value = env[key]; source = key; break; }
  }
  const proxy = value === undefined ? '' : normalizeProxy(value);
  const bypassed = Boolean(proxy && bypassProxy(url, env.no_proxy ?? env.NO_PROXY ?? ''));
  return { proxy: bypassed ? '' : proxy, source, bypassed };
}
export async function loadConfig(cwd = process.cwd(), options = {}) {
  const env = options.env ?? process.env;
  const agentDir = options.agentDir ?? env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');
  const path = join(agentDir, 'webtrail.json');
  let data = {};
  try { data = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read webtrail.json: check that it contains valid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('webtrail.json must contain an object');
  const allowed = ['engine', 'proxy', 'timeoutMs', 'maxChars', 'cacheDir', 'browserPath'];
  for (const key of Object.keys(data)) if (!allowed.includes(key)) throw new Error(`Unknown webtrail.json field: ${key}`);
  const engine = env.PI_WEBTRAIL_ENGINE ?? data.engine ?? 'auto';
  if (!ENGINES.includes(engine)) throw new Error(`engine must be one of: ${ENGINES.join(', ')}`);
  if (own(data, 'proxy')) normalizeProxy(data.proxy);
  if (own(env, 'PI_WEBTRAIL_PROXY')) normalizeProxy(env.PI_WEBTRAIL_PROXY);
  if (data.cacheDir !== undefined && (typeof data.cacheDir !== 'string' || !data.cacheDir.trim())) throw new Error('cacheDir must be a nonempty directory path');
  if (data.browserPath !== undefined && (typeof data.browserPath !== 'string' || !data.browserPath.trim() || /[\r\n\0]/.test(data.browserPath))) throw new Error('browserPath must be an executable path');
  const config = {
    engine,
    timeoutMs: integer(data.timeoutMs, 20000, 1000, 60000, 'timeoutMs'),
    maxChars: integer(data.maxChars, 6000, 500, 20000, 'maxChars'),
    cacheDir: resolve(cwd, env.PI_WEBTRAIL_CACHE_DIR ?? data.cacheDir ?? '.pi/webtrail'),
    browserPath: data.browserPath,
    configPath: path,
  };
  if (own(data, 'proxy')) config.proxy = data.proxy;
  return config;
}
