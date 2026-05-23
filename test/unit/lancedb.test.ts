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

  it('should register process exit hook in :memory: mode and cleanup on exit', async () => {
    const originalOn = process.on;
    const originalOff = process.off;
    let exitHookListener: any = null;
    let registeredEvent: string | null = null;
    let unregisteredEvent: string | null = null;

    process.on = (event: string, listener: any) => {
      if (event === 'exit') {
        exitHookListener = listener;
        registeredEvent = event;
      }
      return originalOn.call(process, event, listener) as any;
    };
    process.off = (event: string, listener: any) => {
      if (event === 'exit') {
        unregisteredEvent = event;
      }
      return originalOff.call(process, event, listener) as any;
    };

    try {
      const client = new LanceDBClient({
        uri: ':memory:',
        driver: { connect: mockConnect } as any
      });

      await client.connect();
      assert.strictEqual(client.isConnected, true);
      assert.strictEqual(registeredEvent, 'exit');
      assert.ok(typeof exitHookListener === 'function');
      assert.ok(client.tempDir !== undefined);

      const fs = await import('fs');
      fs.mkdirSync(client.tempDir!, { recursive: true });
      assert.ok(fs.existsSync(client.tempDir!));

      // Call exitHook manually
      exitHookListener();
      assert.strictEqual(fs.existsSync(client.tempDir!), false);

      // Disconnect should unregister exit listener
      client.disconnect();
      assert.strictEqual(unregisteredEvent, 'exit');
      assert.strictEqual(client._exitHookListener, null);
    } finally {
      process.on = originalOn;
      process.off = originalOff;
    }
  });
});
