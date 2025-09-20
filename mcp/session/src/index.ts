#!/usr/bin/env node

// MCP Session Server using standard MCP SDK
// Supports both stdio and streamable HTTP transports

// Re-export the server implementation
export * from './server.js';

// When run directly, start the server
if (require.main === module) {
  require('./server.js');
}