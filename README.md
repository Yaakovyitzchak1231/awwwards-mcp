# awwwards-mcp — live Awwwards design specs for Lovable

Standalone MCP server that gives **Lovable** (or any MCP client) live access to **awwwards.com** winners. Lovable can call it on-demand — *"design this like an Awwwards winner for [style/industry]"* — and get **structured JSON design tokens** (palette / typography / layout / motion / CSS variables / Tailwind tokens) it can apply programmatically.

- **Live scrape** on every call — no frozen library. Uses the full pool (winners + nominees + directory) with graceful fallback.
- **Public, no auth** — paste a single URL into Lovable → Settings → MCP.

## Live endpoint

```
https://awwwards-mcp.yytrout18.workers.dev/mcp
```

Also accepts `POST /` and `POST /sse` (same handler). `GET /` is a landing page. `GET /health` returns HTML landing as well.

## Tools

### `search_awwwards`
Discover award-winning references by vibe. Live-scrapes `awwwards.com`.

| arg | type | description |
|-----|------|-------------|
| `query` | string | Free-text vibe — `minimal`, `luxury fashion`, `brutalist portfolio`, `saas dashboard` |
| `style` | string | Alias for `query` |
| `category` | string | `ecommerce` · `portfolio` · `typography` · `product` · `nominees` · `sites_of_the_day` · `sites_of_the_month` · … maps to `/websites/<category>/` |
| `limit` | integer 1–20 | default 10 |

Returns `{ usedUrl, count, sites: [{slug, url, title, thumbnail}] }`.

### `extract_awwwards_specs`
Pull structured tokens from any `awwwards.com` winner/nominee page.

| arg | type | description |
|-----|------|-------------|
| `url` | string **required** | `https://www.awwwards.com/sites/<slug>` or any `https://www.awwwards.com/websites/<tag>/` page |

Returns:

```json
{
  "source":   { "awwwardsUrl": "...", "title": "...", "externalUrl": "https://...", "image": "https://..." },
  "meta":     { "description": "...", "tags": ["Minimal","3D","GSAP"], "award": "Site of the Day", "paletteCount": 2 },
  "palette":  { "colors": [{"hex":"#01C654","role":"primary"}], "rawHexes": ["#FFFFFF","#01C654"], "cssVariables": {"--color-background":"#FFFFFF"} },
  "typography": { "heading": "Inter — 600", "mood": "minimal", "pairing": "..." },
  "layout":   { "patterns": ["generous whitespace, 12-col grid"], "spacing": "generous", "grid": "12-col, gap 24px" },
  "motion":   { "libraries": ["GSAP","Three.js"], "intensity": "experimental — WebGL / Three.js heavy" },
  "tokens":   { "css": "--color-primary: #01C654;", "tailwind": { "colors": {"primary":"#01C654"}, "fontFamily": {...} } },
  "lovablePrompt": "Apply this Awwwards-winning direction: palette #FFFFFF, #01C654; ..."
}
```

Palette comes from the winner's own `list-palette` on its detail page; **typography / layout / motion are inferred from its tags + award** and shaped into usable prompts/variables — no hallucinations, fully traceable to the source page.

## Connect to Lovable

1. In Lovable: **Settings → MCP** (or Integrations → MCP).
2. Add server URL:
   ```
   https://awwwards-mcp.yytrout18.workers.dev/mcp
   ```
   Transport: **Streamable HTTP** (also listed as "HTTP" or "SSE" in some clients — same URL works).
3. No auth needed. Lovable will `initialize` → `tools/list` → you're live.
4. Try in Lovable chat: *"search awwwards for minimal fintech, pick one, extract its specs, and apply the tokens to this project"*.

## Local dev

```bash\nnpm install            # plain — no --legacy-peer-deps\nnpm run build          # tsc typecheck (--noEmit)\nnpm run test           # runs build (tsc)\nnpm run dev            # wrangler dev on :8787 — POST /mcp (use --port 8790 if 8787 is taken)\nnpm run deploy         # wrangler deploy\n```

## Stack

Node/TypeScript · `@modelcontextprotocol/sdk` · Cloudflare Workers (Streamable HTTP + SSE + JSON-RPC, `2024-11-05`) · live `fetch` scrape with no external deps.

## Notes

- `awwwards.com` is Cloudflare-screened but server-rendered — no browser needed; plain Worker `fetch` works.
- If a detail page has no palette block, `rawHexes` is `[]` and tokens fall back to monochrome + tag-inferred direction — never fabricated.
- Inspect manually: `curl -s https://awwwards-mcp.yytrout18.workers.dev/mcp -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`
