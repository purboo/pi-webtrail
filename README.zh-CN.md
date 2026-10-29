# pi-webtrail

**搜索网页，把原文留下来。**

给 [Pi](https://pi.dev) 用的免费搜索和网页阅读扩展。只有 `trail_search` / `trail_open` 两个工具，**零运行时 npm 依赖**，默认搜索不需要 API key。

- HTTP(S)、SOCKS5/SOCKS5H 代理和常用代理环境变量。
- 读过的网页保存成带来源、时间的 Markdown，重启、压缩上下文或换子 agent 后仍可查阅。
- 无 SDK、DOM 库、额外模型调用、浏览器下载、安装脚本或启动更新提醒。

需要 Node.js 22.19+ 和系统 **curl**。Pi 提供宿主接口。Google 的可选渲染使用已有 Chromium。

## 安装与使用

```sh
pi install npm:pi-webtrail
```

两个工具有独立前缀，可以和其他联网扩展同时试用：

```js
trail_search({ query: "TypeScript 官方文档" })
trail_search({ query: "TypeScript satisfies operator", engine: "exa", limit: 3 })
trail_open({ url: "https://www.typescriptlang.org/docs/", maxChars: 2000 })
```

搜索返回简短摘要、真实使用的引擎和本地记录；摘要不等于已经核实的网页原文。选中来源后再打开。`trail_open` 返回有限预览和完整文件路径，继续用 Pi 已有的 read / rg 查找。

正文快照保留来源 URL、抓取时间和内容 hash。缓存一小时，`refresh: true` 强制重抓，旧文件保留。支持 HTML 和文本；不包含 PDF、视频、登录态和 JS 页面正文渲染。自带 HTML 提取器保留标题、链接、列表、表格文字和代码，但不是完整浏览器解析器，复杂排版可能不理想。

## 代理

```sh
PI_WEBTRAIL_PROXY=http://127.0.0.1:20172 pi
```

或保存到 `~/.pi/agent/webtrail.json`：

```json
{
  "proxy": "http://127.0.0.1:20172",
  "engine": "auto"
}
```

端口没有硬编码；示例端口需要自行确认。SOCKS 代理可使用 `socks5h://127.0.0.1:1080`，由代理解析目标域名。

优先级：专用环境变量 → 个人配置 → 对应协议的 HTTP(S)_PROXY → ALL_PROXY → 直连。同名大小写变量优先小写。显式空字符串选择直连；NO_PROXY / no_proxy 支持域名、后缀、端口和 `*`，不支持 CIDR。每次重定向重新判断。

代理失效不会自动改为直连。请求不修改全局 fetch，不影响模型和其他扩展的网络。代理凭证不进入命令行和缓存，诊断输出会脱敏。

## 搜索入口

| 引擎 | 行为 |
| --- | --- |
| `auto` | 先 DuckDuckGo，失败后 Bing RSS，保留失败原因 |
| `duckduckgo` | 免费 HTML 搜索，可能限流或要求验证 |
| `bing` | 免费 RSS，非正式稳定 API，服务行为可能变化 |
| `google` | 实验性 Google 搜索，可配置已有 Chromium 执行 JS，仍可能遇到验证码 |
| `exa` | 显式可选的第三方免费 MCP 服务；普通 HTTP 调用，无 SDK，受免费配额限制 |

显式选定引擎时，失败就报告该引擎的错误，不悄悄换成另一家。Exa 使用自己的检索和排序，不是 Google 的镜像；选它会把查询发送到 Exa。默认回退不会使用 Exa。

Google 渲染可在个人配置里增加：

```json
{
  "proxy": "http://127.0.0.1:20172",
  "browserPath": "/usr/bin/chromium"
}
```

只有显式 Google 搜索遇到 JS 页面才启动浏览器。使用临时 profile，不读取日常浏览器的 cookie，不自动解决验证码，不支持浏览器代理认证；可接本机不需要认证的代理。

## 配置与诊断

- `/webtrail doctor`：只查看本地配置、脱敏代理选择和资料目录，不联网。
- `/webtrail test`：用当前引擎做一次实际搜索；不会把 HTTP 200 验证码页当成成功。
- `timeoutMs`：默认 20000，范围 1000–60000。
- `maxChars`：预览默认 6000，范围 500–20000。
- `cacheDir`：默认当前工作目录的 `.pi/webtrail`；也可用 `PI_WEBTRAIL_CACHE_DIR`。
- `PI_WEBTRAIL_ENGINE`：覆盖默认引擎。

配置跟随 Pi 的 agent 目录；没有项目级配置。快照以普通文件保存，不需要数据库；同工作目录的 agent 可以共享，不会自动跨机器或不同工作树同步。引用的行号对应本地 Markdown，不是源站 HTML 行号。

快照保留到手动清理为止，没有自动裁剪。把 `.pi/webtrail/` 加入项目忽略文件；不再需要引用后可以删除该生成目录。POSIX 文件采用私有权限，不保存会话或浏览器 cookie。

公开 URL 在每次重定向时检查；直连检查并固定 DNS 地址。代理远端 DNS 不强制本机解析，其最终地址约束取决于可信代理。网页始终作为外部数据处理。

## 开发

```sh
npm test
npm audit --omit=dev --omit=peer
npm pack --dry-run
```

测试仅用 Node 内置 runner 和本地 HTTP/HTTPS/CONNECT 服务，不需要联网。没有运行时或开发 npm 依赖；optional peers 只是声明 Pi 提供的接口。

MIT
