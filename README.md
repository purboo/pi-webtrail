# pi-webtrail

**Search the web. Keep the sources.**

Free web search and readable local source snapshots for [Pi](https://pi.dev). Two tools, no runtime npm dependencies, no API key required for the default engines.

- **Use your proxy.** HTTP(S), SOCKS5/SOCKS5H and standard proxy environment variables. A failed proxy never silently becomes a direct request.
- **Keep what you read.** Pages become Markdown files with their source URL and fetch time. Use Pi's existing `read` and `rg` to inspect more, or give the path to another agent in the same workspace.
- **Stay small.** No search SDK, MCP SDK, DOM library, browser download, extra model call, install script or startup update check.

[中文说明](README.zh-CN.md)

## Install

```sh
pi install npm:pi-webtrail
```

Requires Node.js 22.19+ and **curl on PATH**. Pi supplies the host APIs. Google rendering optionally uses an existing Chromium executable; it never downloads one.

The tools are named `trail_search` and `trail_open`, so you can try webtrail alongside another web extension.

## Search and read

Ask Pi naturally, or use the tools:

```js
trail_search({ query: "TypeScript official documentation" })
trail_search({ query: "TypeScript satisfies operator", engine: "exa", limit: 3 })
trail_open({ url: "https://www.typescriptlang.org/docs/", maxChars: 2000 })
```

Search returns up to five short results, the engine actually used, and a local JSON record. Snippets are search excerpts, not verified page text. Open only the sources you need.

`trail_open` returns a bounded preview and the full saved file's path. Page snapshots have stable content hashes and are not overwritten by refreshes. A recent snapshot is reused for one hour; `refresh: true` fetches again. HTML and text are supported. Images, PDFs, login-protected pages, and JavaScript-only content extraction are outside this version's scope.

The built-in inert HTML reader preserves headings, links, lists, table text and code blocks. It is intentionally small, not a complete browser HTML parser; complicated layouts can extract imperfectly.

## Proxy

For a local HTTP proxy:

```sh
PI_WEBTRAIL_PROXY=http://127.0.0.1:20172 pi
```

Or create `~/.pi/agent/webtrail.json`:

```json
{
  "proxy": "http://127.0.0.1:20172",
  "engine": "auto"
}
```

There is no hardcoded proxy port. `20172` is an example; confirm which protocols your proxy supports. For a SOCKS endpoint, use `socks5h://127.0.0.1:1080` to resolve target names at the proxy.

Proxy precedence:

1. `PI_WEBTRAIL_PROXY`, including an empty value for direct requests.
2. `proxy` in the personal config, including `""` for direct requests.
3. `https_proxy` / `HTTPS_PROXY` or `http_proxy` / `HTTP_PROXY`, according to the target URL.
4. `all_proxy` / `ALL_PROXY`.
5. Direct connection.

Lowercase standard variables take precedence over uppercase. `no_proxy` / `NO_PROXY` supports `*`, exact hosts, domain suffixes and optional ports; CIDR entries are not supported. The decision is made again for each redirect. Invalid explicit proxy configuration fails rather than being ignored. There is no global fetch patch, so model API traffic and other extensions are unaffected.

Proxy credentials are passed to curl on stdin, excluded from the command line and saved records. `/webtrail doctor` redacts them. Keep credentials in the environment or personal config, not a shared project file.

## Engines

| Engine | Behavior |
| --- | --- |
| `auto` | DuckDuckGo HTML, then Bing RSS on failure. Reports earlier failed attempts. |
| `duckduckgo` | Free HTML search; can be blocked or rate-limited. |
| `bing` | Free RSS search; an unofficial interface whose behavior may change. |
| `google` | Google HTML, with optional Chromium rendering. Experimental; network access alone does not prevent CAPTCHA/JS/consent challenges. |
| `exa` | Explicit, optional [Exa keyless MCP](https://exa.ai/docs/reference/exa-mcp). Uses ordinary HTTP, not an SDK. Free service limits apply. |

An explicit engine is strict. A failed Google request is never returned as a successful search from another engine. Exa has its own retrieval and ranking; it is not Google Search. Selecting it sends your query to Exa. It is not part of the automatic fallback chain.

For Google rendering, set a trusted Chromium executable in personal config:

```json
{
  "proxy": "http://127.0.0.1:20172",
  "browserPath": "/usr/bin/chromium"
}
```

Rendering starts only for an explicit Google search when HTTP requires JavaScript. It uses a temporary profile, does not read your normal browser cookies, and does not solve CAPTCHAs. Chromium proxy authentication is unsupported; use a local proxy without credentials. Browsers may make supporting network requests; the browser adapter is only used for the fixed Google Search entry point.

## Diagnostics and configuration

```text
/webtrail doctor
/webtrail test
```

`doctor` reads local configuration without network requests. `test` runs a small real search with the configured engine. It reports errors rather than counting HTTP 200 challenge pages as success.

Additional personal config fields:

| Field | Default | Meaning |
| --- | --- | --- |
| `engine` | `auto` | Default engine; `PI_WEBTRAIL_ENGINE` overrides it. |
| `timeoutMs` | `20000` | Whole search/request deadline, 1,000–60,000 ms. |
| `maxChars` | `6000` | Default page preview, 500–20,000 characters. |
| `cacheDir` | `.pi/webtrail` in the working directory | Where source files and search records live. `PI_WEBTRAIL_CACHE_DIR` overrides it. |
| `browserPath` | unset | Optional existing Chromium executable for Google. |

The config follows Pi's agent directory (`PI_CODING_AGENT_DIR` or `getAgentDir()` when loaded in Pi). There is no project-local configuration file.

## Stored sources

```text
.pi/webtrail/
  searches/<id>.json
  indexes/<url-hash>.json
  pages/<snapshot-hash>.md
  pages/<snapshot-hash>.json
```

Sources remain readable after restart, compaction or refresh. References refer to local extracted Markdown, not the original HTML's line numbers. Other agents need access to the same directory; different machines or worktrees do not automatically share it.

Files use private permissions on POSIX. Snapshots remain until you remove them; there is no automatic pruning or database. Add `.pi/webtrail/` to your project's ignore file. To reset, remove that generated directory when you no longer need its references. No session transcript, proxy credential or browser cookie is stored there.

Public HTTP(S) URLs are checked on every redirect. Direct requests reject non-public DNS answers and pin the validated address. Proxy-resolved DNS is deliberately not forced through the local resolver; restrictions on the proxy's final target address depend on your trusted proxy. Remote pages remain untrusted data.

## Development

```sh
npm test
npm audit --omit=dev --omit=peer
npm pack --dry-run
```

Tests use Node's built-in runner and local HTTP/HTTPS/CONNECT fixtures, including a public test-only TLS key. No search API or network connection is needed for the test suite. The package has no runtime or development npm dependencies. Optional peers describe Pi's host APIs and are not bundled.

## License

MIT
