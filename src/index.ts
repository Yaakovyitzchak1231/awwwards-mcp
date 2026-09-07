export interface Env {}

const SERVER_INFO = { name: "awwwards-mcp", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

// ---------- helpers ----------
function jsonRpcResult(id: unknown, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
function jsonRpcError(id: unknown, code: number, message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, mcp-session-id, Authorization",
    "Access-Control-Expose-Headers": "mcp-session-id",
  };
}
function decodeHtml(s: string): string {
  return s
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// ---------- awwwards scraping ----------
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Fetch ${url} failed: ${res.status}`);
  return await res.text();
}

function extractSitesFromListing(html: string, limit: number) {
  // collect /sites/<slug>
  const hrefs = [...html.matchAll(/href="(\/sites\/[^"?#]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(hrefs)];
  // try to get title + thumb near each href
  const sites: Array<{ slug: string; url: string; title: string; thumbnail: string | null }> = [];
  for (const href of unique.slice(0, limit * 3)) {
    const slug = href.replace("/sites/", "").replace(/\/$/, "");
    if (!slug || slug.includes("/")) continue;
    // find snippet around href
    const idx = html.indexOf(href);
    const snippet = html.slice(Math.max(0, idx - 5000), idx + 5000);
    const altMatch = snippet.match(new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?alt="([^"]+)"`));
    const titleRaw = altMatch ? altMatch[1] : slug.replace(/-/g, " ");
    const title = decodeHtml(titleRaw).trim();
    // thumbnail: look for assets.awwwards.com near snippet
    const thumbMatch =
      snippet.match(/data-srcset="([^"]+)"/) || snippet.match(/src="(https:\/\/assets\.awwwards\.com[^"]+)"/);
    let thumbnail: string | null = null;
    if (thumbMatch) {
      const raw = thumbMatch[1];
      // data-srcset may be "url 1x, url2 2x" — take first
      thumbnail = raw.split(",")[0].trim().split(" ")[0];
    }
    sites.push({ slug, url: `https://www.awwwards.com${href}`, title, thumbnail });
    if (sites.length >= limit) break;
  }
  return sites;
}

function buildSearchUrls(query?: string, category?: string, style?: string): string[] {
  const urls: string[] = [];
  const q = (query || style || "").trim();
  const cat = (category || "").trim().toLowerCase();

  // category mapping
  const catMap: Record<string, string> = {
    ecommerce: "winner_category_ecommerce",
    portfolio: "winner_category_portfolio",
    typography: "winner_category_typography",
    product: "winner_category_product",
    "no-code": "winner_category_no-code",
    business: "winner_category_business-services",
    nominees: "nominees",
    "sites_of_the_day": "sites_of_the_day",
    sotd: "sites_of_the_day",
    "sites_of_the_month": "sites_of_the_month",
    sotm: "sites_of_the_month",
    "sites_of_the_year": "sites_of_the_year",
    developer: "developer",
    honorable: "honorable",
  };

  if (cat) {
    const mapped = catMap[cat] || cat.replace(/\s+/g, "_").toLowerCase();
    urls.push(`https://www.awwwards.com/websites/${mapped}/`);
  }

  if (q) {
    const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // try tag page
    if (slug) urls.push(`https://www.awwwards.com/websites/${encodeURIComponent(slug)}/`);
    // inspiration search variants
    urls.push(`https://www.awwwards.com/inspiration_search/?text=${encodeURIComponent(q)}`);
    urls.push(`https://www.awwwards.com/websites/?search=${encodeURIComponent(q)}`);
  }

  if (urls.length === 0) urls.push("https://www.awwwards.com/websites/");

  return [...new Set(urls)];
}

async function searchAwwwards(args: { query?: string; style?: string; category?: string; limit?: number }) {
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 20);
  const urls = buildSearchUrls(args.query, args.category, args.style);
  let lastError: string | null = null;
  let tried: string[] = [];

  for (const url of urls) {
    tried.push(url);
    try {
      const html = await fetchHtml(url);
      // quick check for 404/no results
      if (html.includes("No results") && html.length < 10000) continue;
      const sites = extractSitesFromListing(html, limit);
      if (sites.length > 0) {
        return { query: args.query || args.style || null, category: args.category || null, tried, usedUrl: url, count: sites.length, sites };
      }
    } catch (e: any) {
      lastError = e.message;
      continue;
    }
  }
  // fallback: fetch main directory
  try {
    const html = await fetchHtml("https://www.awwwards.com/websites/");
    const sites = extractSitesFromListing(html, limit);
    if (sites.length > 0) return { query: args.query || null, category: args.category || null, tried: [...tried, "https://www.awwwards.com/websites/"], usedUrl: "https://www.awwwards.com/websites/", count: sites.length, sites, note: lastError ? `fallback after errors: ${lastError}` : "fallback to directory" };
  } catch {}
  throw new Error(`No results for query "${args.query || ""}" category "${args.category || ""}". Tried: ${tried.join(", ")}. ${lastError || ""}`);
}

function inferTokens(palette: string[], tags: string[]) {
  const lower = tags.map((t) => t.toLowerCase());
  const has = (...keys: string[]) => keys.some((k) => lower.some((t) => t.includes(k)));

  // typography hints
  let typography: any = {};
  if (has("brutal")) typography = { heading: "Space Grotesk / JetBrains Mono — tight, uppercase", body: "Inter / Suisse — neutral grotesk", mood: "brutalist", pairing: "Brutalist sans + mono" };
  else if (has("luxury", "fashion", "editorial")) typography = { heading: "Playfair Display / Canela — high-contrast serif", body: "Inter / Neue Haas — refined grotesk", mood: "luxury editorial", pairing: "Display serif + neutral sans" };
  else if (has("minimal", "clean")) typography = { heading: "Inter / General Sans — geometric grotesk, 600", body: "Inter / System sans — 400", mood: "minimal", pairing: "Single grotesk family, generous line-height" };
  else if (has("typography")) typography = { heading: "Instrument Serif / Newsreader — editorial", body: "Inter — 400/500", mood: "typographic", pairing: "Serif display + sans body" };
  else typography = { heading: "Inter / Geist — modern grotesk", body: "Inter — 400", mood: "contemporary", pairing: "Modern grotesk system" };

  // motion
  const motionLibraries = tags.filter((t) => ["GSAP", "Three.js", "WebGL", "Motion", "Framer", "Lenis", "Scroll"].some((k) => t.includes(k)));
  let motionIntensity: string = "subtle";
  if (has("3d", "webgl", "three.js")) motionIntensity = "experimental — WebGL / Three.js heavy";
  else if (has("gsap", "parallax", "scroll")) motionIntensity = "bold — scroll-driven GSAP";
  else if (has("storytelling", "interaction", "sound")) motionIntensity = "playful — gesture/audio-reactive";

  // layout
  const layoutPatterns: string[] = [];
  if (has("single page")) layoutPatterns.push("single-page narrative");
  if (has("portfolio", "grid")) layoutPatterns.push("asymmetric grid, large type");
  if (has("ecommerce", "shopify")) layoutPatterns.push("product grid, sticky cart, large imagery");
  if (has("minimal", "clean")) layoutPatterns.push("generous whitespace, 12-col grid, restrained sections");
  if (has("brutal")) layoutPatterns.push("raw blocks, high-contrast, monospace labels");
  if (layoutPatterns.length === 0) layoutPatterns.push("hero full-bleed + editorial sections, max 1200px content width");

  // palette roles
  const paletteRoles = palette.map((hex, i) => {
    const h = hex.toLowerCase();
    // rough role assignment
    let role = "accent";
    if (i === 0) role = "background";
    else if (i === 1) role = "primary";
    else if (h === "#000000" || h === "#ffffff") role = h === "#ffffff" ? "background" : "text";
    return { hex, role };
  });

  // css variables + tailwind
  const cssVariables: Record<string, string> = {};
  paletteRoles.forEach((p, i) => {
    cssVariables[`--color-${p.role}${i > 0 ? `-${i}` : ""}`] = p.hex;
  });
  // ensure text/background defaults
  if (!Object.values(paletteRoles).some((p) => p.role === "text")) cssVariables["--color-text"] = "#111111";
  if (!Object.values(paletteRoles).some((p) => p.role === "background")) cssVariables["--color-bg"] = "#ffffff";

  return { typography, motion: { libraries: motionLibraries, intensity: motionIntensity, effects: has("parallax") ? ["parallax"] : has("gesture") ? ["gesture"] : ["fade/slide on scroll"] }, layout: { patterns: layoutPatterns, spacing: has("minimal") ? "generous (clamp 32-80px sections)" : "balanced (clamp 24-64px)", grid: "12-col, gap 24px" }, paletteRoles, cssVariables };
}

async function extractSpecs(urlInput: string) {
  let url = urlInput.trim();
  if (!url.startsWith("http")) url = "https://www.awwwards.com" + (url.startsWith("/") ? "" : "/") + url;
  const u = new URL(url);
  if (!u.hostname.includes("awwwards.com")) throw new Error("URL must be an awwwards.com page (e.g. https://www.awwwards.com/sites/<slug>)");
  // normalize to /sites/<slug>
  const html = await fetchHtml(u.toString());

  const ogTitle = html.match(/property="og:title" content="([^"]+)"/)?.[1] || html.match(/<title>([^<]+)<\/title>/)?.[1] || "";
  const ogDesc = html.match(/property="og:description" content="([^"]+)"/)?.[1] || "";
  const ogImage = html.match(/property="og:image" content="([^"]+)"/)?.[1] || null;
  const title = decodeHtml(ogTitle.replace(" - Awwwards Nominee", "").replace(" - Awwwards", "").trim());

  // palette: look for js-palette-item style="background: #XXXXXX"
  const palette: string[] = [];
  const paletteRe = /js-palette-item[^>]*style="[^"]*background:\s*(#[0-9a-fA-F]{3,8})/g;
  for (const m of html.matchAll(paletteRe)) {
    const hex = m[1].toUpperCase();
    if (!palette.includes(hex)) palette.push(hex);
  }
  // fallback: any background hex near palette section
  if (palette.length === 0) {
    const idx = html.indexOf("list-palette");
    if (idx !== -1) {
      const snippet = html.slice(idx, idx + 8000);
      for (const m of snippet.matchAll(/(#[0-9a-fA-F]{6})/g)) {
        const hex = m[1].toUpperCase();
        if (!palette.includes(hex) && !["#A7A7A7", "#EDEDED", "#F8F8F8"].includes(hex)) palette.push(hex);
      }
    }
  }

  // external site url: "Visit Website" link
  let externalUrl: string | null = null;
  const visitMatch = html.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*(?:Visit|Go to)[^<]*</i);
  if (visitMatch) externalUrl = visitMatch[1];
  if (!externalUrl) {
    const m2 = html.match(/href="(https?:\/\/(?!www\.awwwards\.com)[^"]+)"[^>]*class="[^"]*button[^"]*"/);
    if (m2) externalUrl = m2[1];
  }

  // tags: href="/websites/..."
  const tagMatches = [...html.matchAll(/href="\/websites\/[^"]*"[^>]*>([^<]+)<\/a>/g)].map((m) => decodeHtml(m[1].trim()).replace(/\s+/g, " ").trim()).filter((t) => t.length > 1 && t.length < 40);
  const tags = [...new Set(tagMatches)].slice(0, 20);

  // categories / award
  const award = html.includes("Site of the Day") ? "Site of the Day" : html.includes("Site of the Month") ? "Site of the Month" : html.includes("Developer Award") ? "Developer Award" : html.includes("Honorable Mention") ? "Honorable Mention" : "Nominee / Winner";

  const inferred = inferTokens(palette, tags);

  // Build structured JSON tokens
  const cssVars = inferred.cssVariables;
  const tailwindColors: Record<string, string> = {};
  inferred.paletteRoles.forEach((p: any, i: number) => {
    tailwindColors[`${p.role}${i > 0 ? `-${i}` : ""}`] = p.hex;
  });

  const tokens = {
    source: { awwwardsUrl: u.toString(), title, externalUrl, image: ogImage },
    meta: { description: decodeHtml(ogDesc).trim(), tags, award, paletteCount: palette.length },
    palette: {
      colors: inferred.paletteRoles,
      rawHexes: palette,
      mood: inferred.typography.mood,
      cssVariables: cssVars,
    },
    typography: inferred.typography,
    layout: inferred.layout,
    motion: inferred.motion,
    components: tags.filter((t) => ["Header Design", "UI design", "Responsive Design", "Gestures", "3D"].some((k) => t.toLowerCase().includes(k.toLowerCase()))).slice(0, 8),
    tokens: {
      css: Object.entries(cssVars)
        .map(([k, v]) => `${k}: ${v};`)
        .join("\n"),
      tailwind: {
        colors: tailwindColors,
        fontFamily: {
          heading: inferred.typography.heading,
          body: inferred.typography.body,
        },
      },
    },
    lovablePrompt: `Apply this Awwwards-winning direction: palette ${palette.join(", ") || "minimal monochrome"}; ${inferred.typography.pairing}; layout: ${inferred.layout.patterns.join(", ")}; motion: ${inferred.motion.intensity} (${inferred.motion.libraries.join(", ") || "CSS only"}). Reference: ${title} — ${u.toString()}`,
  };

  return tokens;
}

// ---------- MCP tool definitions ----------
const TOOLS = [
  {
    name: "search_awwwards",
    description:
      "Search Awwwards winners/nominees/directory by style/industry/category. Live-scrapes awwwards.com. Use when Lovable needs to discover award-winning references for a vibe (e.g. 'minimal fintech', 'brutalist portfolio', 'luxury ecommerce'). Returns site cards with titles, URLs, and thumbnails.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text vibe/industry/style, e.g. 'minimal', 'brutalist portfolio', 'luxury fashion', 'saas dashboard'" },
        style: { type: "string", description: "Alias for query — design style filter" },
        category: {
          type: "string",
          description:
            "Category filter: ecommerce, portfolio, typography, product, business, nominees, sites_of_the_day, sites_of_the_month, etc. Maps to /websites/<category>/",
        },
        limit: { type: "integer", description: "Max results (1-20, default 10)", minimum: 1, maximum: 20, default: 10 },
      },
      required: [],
    },
  },
  {
    name: "extract_awwwards_specs",
    description:
      "Given any awwwards.com URL (e.g. https://www.awwwards.com/sites/<slug> or https://www.awwwards.com/websites/<tag>/), live-scrape and return structured JSON design tokens: palette hexes + CSS variables, typography pairing, layout patterns, motion libraries/intensity, components — ready for Lovable to apply programmatically.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full awwwards.com URL to extract specs from. Example: https://www.awwwards.com/sites/why-zero" },
      },
      required: ["url"],
    },
  },
];

// ---------- MCP request handler ----------
async function handleRpc(body: any): Promise<any> {
  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== "2.0") throw new Error("Invalid JSON-RPC");

  // notifications have no id — no response
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    const result = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    };
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "notifications/initialized") return null;
  if (method === "ping") {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    const result = { tools: TOOLS };
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      let content: any;
      if (name === "search_awwwards") {
        const data = await searchAwwwards(args);
        content = [{ type: "text", text: JSON.stringify(data, null, 2) }];
      } else if (name === "extract_awwwards_specs") {
        if (!args.url) throw new Error("Missing required argument: url");
        const data = await extractSpecs(args.url);
        content = [{ type: "text", text: JSON.stringify(data, null, 2) }];
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
      const result = { content };
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result };
    } catch (e: any) {
      const result = { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      if (isNotification) return null;
      return { jsonrpc: "2.0", id, result };
    }
  }

  // unknown method
  if (isNotification) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ---------- Worker fetch ----------
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() as any });
    }

    // Landing page
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>awwwards-mcp — MCP for Lovable</title>
<style>
  :root{--bg:#0a0a0a;--fg:#ededed;--muted:#9a9a9a;--accent:#ff3b30;--card:#171717;--border:#262626}
  *{box-sizing:border-box}body{margin:0;font-family:ui-sans-system,Inter,system-ui,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6}
  .wrap{max-width:780px;margin:0 auto;padding:48px 24px}
  h1{font-size:32px;margin:0 0 8px;letter-spacing:-0.02em}h1 span{color:var(--accent)}
  .sub{color:var(--muted);margin:0 0 28px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:20px 20px;margin:16px 0}
  code,pre{font-family:ui-monospace,Menlo,monospace;font-size:13px}
  pre{background:#0f0f0f;border:1px solid var(--border);border-radius:10px;padding:14px;overflow:auto}
  .url{user-select:all;background:#0f0f0f;border:1px solid var(--border);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:12px;word-break:break-all}
  .btn{background:var(--fg);color:var(--bg);border:0;border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer;white-space:nowrap}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:640px){.grid{grid-template-columns:1fr}}
  .badge{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;background:var(--accent);color:#fff;border-radius:999px;padding:4px 10px;font-weight:700}
  a{color:var(--fg);text-decoration:underline;text-underline-offset:3px}
  .muted{color:var(--muted)}
</style></head>
<body><div class="wrap">
  <div class="badge">MCP · Streamable HTTP · Public</div>
  <h1>awwwards<span>-mcp</span></h1>
  <p class="sub">Give Lovable live access to Awwwards winners — palette, typography, layout &amp; motion as structured JSON tokens. Live-scrapes <code>awwwards.com</code> on each call.</p>

  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><strong>MCP endpoint (paste into Lovable → Settings → MCP)</strong><span class="muted" style="font-size:12px">Streamable HTTP</span></div>
    <div class="url" style="margin-top:12px"><code id="endpoint">${url.origin}/mcp</code><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('endpoint').textContent)">Copy</button></div>
    <div class="muted" style="font-size:12px;margin-top:8px">Also accepts POST at <code>/</code> and <code>/sse</code> — same handler. No auth.</div>
  </div>

  <div class="grid">
    <div class="card"><strong>search_awwwards</strong><div class="muted" style="font-size:13px;margin:6px 0 10px">Discover winners by vibe.</div><pre>{
  "query": "minimal fintech",
  "category": "portfolio",
  "limit": 8
}</pre></div>
    <div class="card"><strong>extract_awwwards_specs</strong><div class="muted" style="font-size:13px;margin:6px 0 10px">Pull JSON tokens from any winner.</div><pre>{
  "url": "https://www.awwwards.com/sites/why-zero"
}</pre></div>
  </div>

  <div class="card">
    <strong>What Lovable gets back (extract)</strong>
    <pre>{
  "palette": { "colors": [{"hex":"#01C654","role":"primary"}], "cssVariables": {"--color-primary":"#01C654"} },
  "typography": { "heading": "Inter — 600", "mood": "minimal" },
  "layout": { "patterns": ["generous whitespace, 12-col grid"] },
  "motion": { "libraries": ["GSAP"], "intensity": "bold" },
  "tokens": { "css": "--color-primary: #01C654;", "tailwind": {"colors": {"primary":"#01C654"}} }
}</pre>
    <div class="muted" style="font-size:12px">Lovable prompt: <em>"design this like an Awwwards winner for luxury fashion — search awwwards for luxury, pick one, extract its specs, and apply the tokens."</em></div>
  </div>

  <div class="card muted" style="font-size:13px">
    <strong style="color:var(--fg)">Notes</strong><br>
    • Live scrape — no frozen library. If awwwards.com is slow, the tool returns the error verbatim so Lovable can retry.<br>
    • Palette comes from the winner's own <code>list-palette</code> on its detail page; typography/layout/motion are inferred from its tags + award — structured for programmatic use.<br>
    • Deploy: <code>npm i && npx wrangler deploy</code> → paste the <code>workers.dev/mcp</code> URL into Lovable.<br>
    • Health: <a href="/health">/health</a> · MCP spec: <code>2024-11-05</code>
  </div>

  <div class="muted" style="font-size:12px;margin-top:18px">Built for Jacob · Node/TypeScript on Cloudflare Workers · MCP SDK ${SERVER_INFO.version}</div>
</div>
<script>document.getElementById('endpoint').textContent = location.origin + '/mcp'</script>
</body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders() } });
    }

    // MCP: handle POST JSON-RPC at /, /mcp, /sse, /messages
    if (request.method === "POST") {
      const ct = request.headers.get("content-type") || "";
      let body: any = null;
      try {
        const text = await request.text();
        if (!text.trim()) throw new Error("empty body");
        body = JSON.parse(text);
      } catch (e: any) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: `Parse error: ${e.message}` } }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      // batch support
      if (Array.isArray(body)) {
        const results = await Promise.all(body.map((b) => handleRpc(b)));
        const filtered = results.filter((r) => r !== null);
        if (filtered.length === 0) return new Response(null, { status: 202, headers: corsHeaders() as any });
        return new Response(JSON.stringify(filtered), { headers: { "Content-Type": "application/json", ...corsHeaders() } });
      } else {
        const res = await handleRpc(body);
        if (res === null) return new Response(null, { status: 202, headers: corsHeaders() as any });
        // MCP Streamable HTTP expects JSON response
        const headers: Record<string, string> = { "Content-Type": "application/json", ...corsHeaders() };
        // optional session id for stateful clients
        if (body.method === "initialize") headers["mcp-session-id"] = crypto.randomUUID();
        return new Response(JSON.stringify(res), { headers });
      }
    }

    // SSE GET (for old clients)
    if (request.method === "GET" && (url.pathname === "/sse" || url.pathname === "/mcp")) {
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/event-stream")) {
        const stream = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode(`event: endpoint\ndata: ${url.origin}/mcp\n\n`));
            // keep alive
            const iv = setInterval(() => controller.enqueue(enc.encode(`: keepalive\n\n`)), 15000);
            // close after 55s (workers limit)
            setTimeout(() => {
              clearInterval(iv);
              controller.close();
            }, 55000);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...corsHeaders(),
          },
        });
      }
      // otherwise fall through to landing
      return new Response(null, { status: 302, headers: { Location: "/", ...corsHeaders() } });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders() as any });
  },
};
