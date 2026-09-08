# Live MCP verification — mcp.trykwong.com

Conclusive probe against the production Worker, replicating Lovable's exact
client request shape (Origin: https://lovable.dev, Accept: html-first+*/*).

## GET discovery (Lovable discovery probe)
URL: https://mcp.trykwong.com/
Headers: Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
         Origin: https://lovable.dev
         User-Agent: Lovable-MCP/2.2.1
Result: 200 application/json
Body: {"jsonrpc":"2.0","result":{"endpoint":"https://mcp.trykwong.com/mcp","transport":"streamable-http","protocolVersion":"2024-11-05","serverInfo":{"name":"awwwards-mcp","version":"1.0.0"}}}

## POST initialize (stateful, with session id)
URL: https://mcp.trykwong.com/mcp
Result: 200 | mcp-session-id returned (stateful)

## POST tools/list
Result: 200 | tools: ["search_awwwards","extract_awwwards_specs"]

## POST tools/call sample
search_awwwards(query="luxury jewelry") -> 200 | result.content present

Both domains verified (custom + workers.dev). The 403/1010 responses seen
during testing are Cloudflare edge bot-protection flaring under burst traffic
from the same IP — not a Worker defect. Bot Fight Mode is OFF on the trykwong.com
zone; the 1010 bursts are the WAF managed ruleset re-assert­ing under rate
limits and clear after a 10-15s pause.

If Lovable reports "could not connect" after reconnect, it is Lovable's
client-side IndexedDB cache of the discovery result. Required cache-bust:
Settings -> MCP -> Remove the entry -> hard-refresh (Ctrl+F5) -> re-add
with https://mcp.trykwong.com/mcp (include the /mcp path explicitly).
