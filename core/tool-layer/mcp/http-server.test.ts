import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FactoryContext } from './context.js';
import { startHttpServer } from './server.js';

const baseCtx: FactoryContext = {
  runId: 'run-test',
  projectId: 'proj-test',
  workItemId: 'item-1',
  workspaceRoot: '/tmp',
  serverPort: 0,
};

describe('startHttpServer', () => {
  it('exports startHttpServer as a function', () => {
    expect(typeof startHttpServer).toBe('function');
  });

  it('returns a server with a close method', async () => {
    const server = await startHttpServer(baseCtx, 0);
    expect(typeof server.close).toBe('function');
    await new Promise<void>((res) => server.close(() => res()));
  });

  it('responds 200 to POST /mcp with valid JSON-RPC', async () => {
    const server = await startHttpServer(baseCtx, 0);
    const port = (server.address() as { port: number }).port;

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    });

    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body,
    });

    expect(response.status).toBe(200);
    await new Promise<void>((res) => server.close(() => res()));
  });
});
