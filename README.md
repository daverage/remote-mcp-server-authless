# MCP Server - Cloudflare Workers Deployment

This directory contains the built MCP server ready for deployment to Cloudflare Workers.

## Files

- `index.js` - Main worker script (entry point)
- `embedded-data.js` - Embedded RAG data (55219257 bytes)
- `package.json` - Dependencies for deployment

## Deployment

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy the worker:
   ```bash
   wrangler deploy
   ```

## Environment Variables

Set these in your Cloudflare Workers dashboard or via wrangler:

- `SEARCH_API_KEY` - Google Custom Search API key
- `CUSTOM_SEARCH_ENGINE_ID` - Google Custom Search Engine ID

## MCP Tools Available

1. `search_rag_knowledge` - Search embedded RAG data
2. `search_internet` - General internet search
3. `search_gamified_sites` - Search gamified.uk and marczewski.me.uk
4. `get_writing_style` - Get writing style guidelines
5. `scrape_gamified_content` - Scrape content from allowed domains

## Testing

Test the deployed worker:

```bash
curl https://your-worker.your-subdomain.workers.dev/
```

Built on: 2025-08-17T17:15:03.533Z
