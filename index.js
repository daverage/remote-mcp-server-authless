import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { EMBEDDED_RAG_DATA, EmbeddedRAGSearch } from './embedded-data.js';

// Cloudflare Workers compatible MCP Server
class CloudflareRAGMCPServer {
  constructor(env) {
    this.env = env;
    this.server = new Server(
      {
        name: 'rag-blog-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Use embedded RAG data
    this.ragData = EMBEDDED_RAG_DATA;
    this.ragSearch = new EmbeddedRAGSearch(this.ragData);

    this.setupHandlers();
  }

  async loadRAGData() {
    // Data is already embedded, just log the metadata
    console.log('RAG data loaded:', this.ragData.metadata);
    console.log(`Total items: ${this.ragData.metadata.totalItems}`);
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_rag_knowledge',
            description: 'Search through the RAG knowledge base including training data, style guides, Q&A pairs, and documents',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query to find relevant information'
                },
                category: {
                  type: 'string',
                  enum: ['training', 'style', 'qa', 'documents', 'all'],
                  description: 'Category to search in (default: all)'
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 5)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'search_internet',
            description: 'Search the internet for information using Google Custom Search',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query'
                },
                site: {
                  type: 'string',
                  description: 'Specific site to search (e.g., gamified.uk, marczewski.me.uk)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'search_gamified_sites',
            description: 'Search specifically on gamified.uk and marczewski.me.uk domains',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for gamification content'
                },
                domain: {
                  type: 'string',
                  enum: ['gamified.uk', 'marczewski.me.uk', 'both'],
                  description: 'Which domain to search (default: both)'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'get_writing_style',
            description: 'Get writing style and persona information for blog content creation',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  description: 'Specific style category to retrieve'
                }
              }
            }
          },
          {
            name: 'scrape_gamified_content',
            description: 'Scrape content from gamified.uk or marczewski.me.uk pages',
            inputSchema: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                  description: 'URL to scrape content from'
                },
                extract_type: {
                  type: 'string',
                  enum: ['text', 'links', 'headings', 'all'],
                  description: 'Type of content to extract (default: text)'
                }
              },
              required: ['url']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'search_rag_knowledge':
            return await this.searchRAGKnowledge(args);
          case 'search_internet':
            return await this.searchInternet(args);
          case 'search_gamified_sites':
            return await this.searchGamifiedSites(args);
          case 'get_writing_style':
            return await this.getWritingStyle(args);
          case 'scrape_gamified_content':
            return await this.scrapeGamifiedContent(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Tool execution failed: ${error.message}`);
      }
    });
  }

  async searchRAGKnowledge(args) {
    const { query, category = 'all', limit = 5 } = args;
    
    // Use the embedded search functionality
    const results = this.ragSearch.search(query, category, limit);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            category,
            results,
            total_found: results.length,
            data_source: 'embedded_rag_data'
          }, null, 2)
        }
      ]
    };
  }

  async searchInternet(args) {
    const { query, site } = args;
    
    try {
      // Use Google Custom Search API if available
      const apiKey = this.env.SEARCH_API_KEY;
      const cseId = this.env.CUSTOM_SEARCH_ENGINE_ID;
      
      if (!apiKey || !cseId) {
        throw new Error('Search API credentials not configured');
      }

      let searchQuery = query;
      if (site) {
        searchQuery = `site:${site} ${query}`;
      }

      const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(searchQuery)}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(`Search API error: ${data.error?.message || 'Unknown error'}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              query: searchQuery,
              results: data.items?.slice(0, 5).map(item => ({
                title: item.title,
                link: item.link,
                snippet: item.snippet
              })) || [],
              total_results: data.searchInformation?.totalResults || 0
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error searching internet: ${error.message}`
          }
        ]
      };
    }
  }

  async searchGamifiedSites(args) {
    const { query, domain = 'both' } = args;
    const results = [];

    const domains = domain === 'both' ? ['gamified.uk', 'marczewski.me.uk'] : [domain];

    for (const siteDomain of domains) {
      try {
        const searchResult = await this.searchInternet({ query, site: siteDomain });
        const searchData = JSON.parse(searchResult.content[0].text);
        
        results.push({
          domain: siteDomain,
          results: searchData.results,
          total_results: searchData.total_results
        });
      } catch (error) {
        results.push({
          domain: siteDomain,
          error: `Failed to search ${siteDomain}: ${error.message}`
        });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            domains_searched: domains,
            results
          }, null, 2)
        }
      ]
    };
  }

  async scrapeGamifiedContent(args) {
    const { url, extract_type = 'text' } = args;
    
    // Validate URL is from allowed domains
    const allowedDomains = ['gamified.uk', 'marczewski.me.uk'];
    const urlObj = new URL(url);
    
    if (!allowedDomains.includes(urlObj.hostname)) {
      throw new Error('URL must be from gamified.uk or marczewski.me.uk');
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RAG-Blog-MCP-Server/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();
      
      // Simple HTML parsing for Cloudflare Workers
      let extractedContent = {};
      
      if (extract_type === 'text' || extract_type === 'all') {
        // Extract text content (simplified)
        const textContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        extractedContent.text = textContent.substring(0, 2000); // Limit length
      }
      
      if (extract_type === 'headings' || extract_type === 'all') {
        const headings = [];
        const headingMatches = html.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi);
        if (headingMatches) {
          headings.push(...headingMatches.map(h => h.replace(/<[^>]+>/g, '').trim()));
        }
        extractedContent.headings = headings;
      }
      
      if (extract_type === 'links' || extract_type === 'all') {
        const links = [];
        const linkMatches = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi);
        if (linkMatches) {
          links.push(...linkMatches.slice(0, 10).map(link => {
            const hrefMatch = link.match(/href=["']([^"']+)["']/);
            const textMatch = link.match(/>([^<]+)<\/a>/);
            return {
              url: hrefMatch ? hrefMatch[1] : '',
              text: textMatch ? textMatch[1].trim() : ''
            };
          }));
        }
        extractedContent.links = links;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              url,
              extract_type,
              content: extractedContent,
              scraped_at: new Date().toISOString()
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error scraping content: ${error.message}`
          }
        ]
      };
    }
  }

  async getWritingStyle(args) {
    const { category } = args;
    
    // Use the embedded search functionality for writing style
    const styleData = this.ragSearch.getWritingStyle(category);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            category: category || 'all',
            style_guidelines: styleData,
            total_guidelines: styleData.length,
            data_source: 'embedded_rag_data'
          }, null, 2)
        }
      ]
    };
  }

  async handleRequest(request) {
    // Handle HTTP requests for Cloudflare Workers
    if (request.method === 'POST') {
      try {
        const body = await request.json();
        
        // Process MCP request
        if (body.method === 'tools/list') {
          const response = await this.server.request(body);
          return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        if (body.method === 'tools/call') {
          const response = await this.server.request(body);
          return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        return new Response('Method not supported', { status: 400 });
      } catch (error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
      }
    }
    
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'RAG Blog MCP Server',
        version: '1.0.0',
        status: 'running',
        capabilities: ['search_rag_knowledge', 'search_internet', 'search_gamified_sites', 'get_writing_style', 'scrape_gamified_content']
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Method not allowed', { status: 405 });
  }
}

// Cloudflare Workers entry point
export default {
  async fetch(request, env, ctx) {
    const server = new CloudflareRAGMCPServer(env);
    await server.loadRAGData();
    return server.handleRequest(request);
  }
};