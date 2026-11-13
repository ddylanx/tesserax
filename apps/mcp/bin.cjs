#!/usr/bin/env node
// Entry for MCP clients (`.mcp.json`): loads the TypeScript source like the api does, from any working directory.
require('@swc-node/register');
require('./src/main.ts');
