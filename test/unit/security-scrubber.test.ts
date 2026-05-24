import { describe, it } from 'node:test';
import assert from 'node:assert';
import { StructuralCleaner } from '../../lib/scrubber/stages/structural-cleaner.js';

describe('Layer 0 Scrubber - Security Redaction', () => {
  const cleaner = new StructuralCleaner({});

  it('should redact email addresses', async () => {
    const raw = 'Please contact support@example.com for help or user.name+tag@sub.domain.co.';
    const cleaned = await cleaner.clean(raw);
    assert.ok(!cleaned.includes('support@example.com'));
    assert.ok(!cleaned.includes('user.name+tag@sub.domain.co'));
    assert.ok(cleaned.includes('[REDACTED_EMAIL]'));
  });

  it('should redact IPv4 addresses', async () => {
    const raw = 'Server running on 192.168.1.1 and database at 10.0.0.254.';
    const cleaned = await cleaner.clean(raw);
    assert.ok(!cleaned.includes('192.168.1.1'));
    assert.ok(!cleaned.includes('10.0.0.254'));
    assert.ok(cleaned.includes('[REDACTED_IP]'));
  });

  it('should redact 64-character private keys', async () => {
    const raw = 'Using private key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 and eth key d39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80123456789.';
    const cleaned = await cleaner.clean(raw);
    assert.ok(!cleaned.includes('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'));
    assert.ok(cleaned.includes('[REDACTED_SECRET_KEY]'));
  });

  it('should redact OpenAI API keys', async () => {
    const raw = 'Bearer sk-proj-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP or key sk-1234567890abcdefghijklmnopqrstuvwxyz123456';
    const cleaned = await cleaner.clean(raw);
    assert.ok(!cleaned.includes('sk-proj-1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP'));
    assert.ok(!cleaned.includes('sk-1234567890abcdefghijklmnopqrstuvwxyz123456'));
    assert.ok(cleaned.includes('[REDACTED_API_KEY]'));
  });

  it('should redact bearer tokens', async () => {
    const raw = 'Authorization: Bearer mySecretTokenValue123';
    const cleaned = await cleaner.clean(raw);
    assert.ok(!cleaned.includes('mySecretTokenValue123'));
    assert.ok(cleaned.includes('Bearer [REDACTED_TOKEN]'));
  });

  it('should redact assignments of keys and passwords (quoted and unquoted)', async () => {
    const raw = 'password = "supersecretpassword123", api_key: \'my-awesome-secret-token\', token=unquotedSecretTokenValue';
    const cleaned = await cleaner.clean(raw);
    assert.ok(!cleaned.includes('supersecretpassword123'));
    assert.ok(!cleaned.includes('my-awesome-secret-token'));
    assert.ok(!cleaned.includes('unquotedSecretTokenValue'));
    assert.ok(cleaned.includes('password = "[REDACTED_SECRET]"'));
    assert.ok(cleaned.includes('api_key: \'[REDACTED_SECRET]\''));
    assert.ok(cleaned.includes('token=[REDACTED_SECRET]'));
  });
});
