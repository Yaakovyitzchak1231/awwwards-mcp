# Connect awwwards-mcp to Lovable (verified procedure)

## Server status (verified live, version 724ed802, branch main @ d238cc8)
| Probe | URL | Result |
|---|---|---|
| GET discovery | https://mcp.trykwong.com/ (and /mcp) | 200 application/json |
| POST initialize | https://mcp.trykwong.com/mcp | 200 (prompts+prompts+resources caps) |
| POST tools/list | https://mcp.trykwong.com/mcp | 200 -> search_awwwards, extract_awwwards_specs |
| Cloudflare Access | zone trykwong.com | OFF / not enforcing |
| Bot Fight Mode | trykwong.com zone | OFF |
| SSL | mcp.trykwong.com | active (Cloudflare provision) |

NOTE: This Worker is NOT a Cloudflare catalog MCP app (wrangler.toml has no
mcp_app/access binding). Lovable sees it via "Add custom MCP server", not the
catalog. The screenshot URL dash.cloudflare.com/.../mcp-server/add is the
Cloudflare MCP *catalog* UI — registering there is a manual dashboard step
that surfaces it like Dev21. Until then, use "Add custom MCP server".

## Required Lovable client steps (browser-only)
1. Settings -> MCP -> find existing awwwards-mcp entry -> REMOVE it.
2. Hard-refresh the lovable.dev tab (Ctrl+Shift+R / Cmd+Shift+R).
   This clears Lovable's local IndexedDB cache of the stale discovery result
   (that cache held the old text/plain-on-GET and OAuth-attempt state).
3. Add custom MCP server:
   Server URL: https://mcp.trykwong.com/mcp   (MUST include /mcp)
   Authentication: "No authentication"
   Transport: Streamable HTTP (default)
   Save.
4. Lovable GETs https://mcp.trykwong.com/ for discovery -> 200 JSON ->
   POSTs initialize -> 200 -> GET tools/list -> both tools appear.

## If it still fails
The console errors (Failed to fetch api.lovable.dev, Error initiating OAuth
connection) are Lovable talking to ITS OWN backend, not the MCP endpoint.
If they persist after the cache-bust, disable content blockers on lovable.dev
and ensure the tab is on https (not a proxy-intercepted connection), then
re-add.
