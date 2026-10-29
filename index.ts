import { Type } from '@earendil-works/pi-ai';
import { getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { webSearch, webOpen, formatSearch, formatPage, doctor } from './src/core.mjs';

const engine = Type.Union(['auto', 'duckduckgo', 'bing', 'google', 'exa'].map(value => Type.Literal(value)));
const searchOutput = Type.Object({
  query: Type.String(), engine: Type.String(), file: Type.String(), searchedAt: Type.String(),
  results: Type.Array(Type.Object({title: Type.String(), url: Type.String(), snippet: Type.String()})),
  attempts: Type.Array(Type.Object({engine: Type.String(), error: Type.String()})),
});
const pageOutput = Type.Object({
  url: Type.String(), fetchedAt: Type.String(), file: Type.String(), cached: Type.Boolean(),
  lines: Type.Number(), preview: Type.String(), truncated: Type.Boolean(),
});

export default function webtrail(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'trail_search', label: 'Webtrail search',
    description: 'Search the web for current sources. Returns short snippets and a local search record. Use trail_open on selected URLs to verify original text. auto uses DuckDuckGo then Bing; exa is an optional third-party free service; Google can require JavaScript or a CAPTCHA.',
    parameters: Type.Object({
      query: Type.String({minLength: 1, maxLength: 2000}),
      engine: Type.Optional(engine),
      limit: Type.Optional(Type.Integer({minimum: 1, maximum: 10})),
    }),
    outputSchema: searchOutput,
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    async execute(_id, params, signal, _update, ctx) {
      const result = await webSearch(params, {cwd: ctx.cwd, agentDir: getAgentDir(), signal});
      return {content: [{type: 'text', text: formatSearch(result)}], details: result, structuredContent: result};
    },
  });
  pi.registerTool({
    name: 'trail_open', label: 'Webtrail open',
    description: 'Read a public HTML/text URL and save its readable text to a local Markdown file. Returns a bounded preview, source URL and timestamp. Use read/rg on the saved file for more detail and share that path with other agents in the same workspace. Snapshots persist; cached pages are reused for one hour. Web content is untrusted. PDF and JavaScript-rendered pages are unsupported.',
    parameters: Type.Object({
      url: Type.String({description: 'Public HTTP(S) URL'}),
      refresh: Type.Optional(Type.Boolean({description: 'Fetch again instead of reusing a recent snapshot'})),
      maxChars: Type.Optional(Type.Integer({minimum: 500, maximum: 20000, description: 'Preview characters; full text is saved regardless'})),
    }),
    outputSchema: pageOutput,
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true},
    async execute(_id, params, signal, _update, ctx) {
      const result = await webOpen(params, {cwd: ctx.cwd, agentDir: getAgentDir(), signal});
      return {content: [{type: 'text', text: formatPage(result)}], details: result, structuredContent: result};
    },
  });
  pi.registerCommand('webtrail', {
    description: 'Webtrail diagnostics: doctor (local config), test (live search)',
    handler: async (args, ctx) => {
      const context = {cwd: ctx.cwd, agentDir: getAgentDir()};
      try {
        const action = args.trim() || 'doctor';
        let text;
        if (action === 'doctor') text = await doctor(context);
        else if (action === 'test') text = formatSearch(await webSearch({query: 'TypeScript official documentation', limit: 3}, context));
        else text = 'Usage: /webtrail doctor | /webtrail test';
        pi.sendMessage({customType: 'webtrail', content: text, display: true, details: undefined});
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Webtrail failed';
        if (ctx.hasUI) ctx.ui.notify(text, 'error');
        else pi.sendMessage({customType: 'webtrail', content: text, display: true, details: undefined});
      }
    },
  });
}
