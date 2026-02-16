import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LanceDBClient } from '../../lib/memory/adapters/client.js';
import { mockConnect } from '../mocks/lancedb.js';

describe('LanceDBClient', () => {
  it('should connect using injected driver', async () => {
    // Inject mock driver
    const client = new LanceDBClient({
      uri: 'mem://test',
      driver: { connect: mockConnect } as any
    });

    await client.connect();
    assert.strictEqual(client.isConnected, true);
  });

  it('should retry connection on failure', async () => {
    let attempts = 0;
    const failingDriver = {
      connect: async (uri: string) => {
        attempts++;
        if (attempts < 3) throw new Error('Network error');
        return mockConnect(uri);
      }
    };

    const client = new LanceDBClient({
      driver: failingDriver as any,
      maxRetries: 3,
      retryDelay: 10
    });

    await client.connect();
    assert.strictEqual(client.isConnected, true);
    assert.strictEqual(attempts, 3);
  });
});
