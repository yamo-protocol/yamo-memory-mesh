import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';
import { MAX_KEYWORD_FILTER_TOKENS, keywordFilterTokens } from '../../lib/memory/mesh/skills.js';

// workspace-8nj: searchSkills built one LIKE condition per query token, three per
// token, with no bound. Lance refuses more than 500 conditions, and a much larger
// filter overflowed its parser first — a SIGSEGV that killed the daemon on every
// grounded prompt of ~7.5 KB or more. These tests run against a real temporary
// LanceDB table: the crash was native, so a mock could not have caught it.

describe('searchSkills with a long query (workspace-8nj)', () => {
  it('bounds the keyword filter to a few distinct tokens, in order of appearance', () => {
    const tokens = ['beta', 'alpha', 'beta', 'gamma', 'alpha', 'delta'];
    assert.deepStrictEqual(keywordFilterTokens(tokens), ['beta', 'alpha', 'gamma', 'delta']);
    assert.deepStrictEqual(keywordFilterTokens(tokens, 2), ['beta', 'alpha']);
    assert.deepStrictEqual(keywordFilterTokens([]), []);
    const many = Array.from({ length: 5000 }, (_, i) => `tok${i}`);
    assert.strictEqual(keywordFilterTokens(many).length, MAX_KEYWORD_FILTER_TOKENS);
    // three LIKE conditions per token must stay well under Lance's 500-condition limit
    assert.ok(MAX_KEYWORD_FILTER_TOKENS * 3 <= 250);
  });

  it('survives a 60 KB query with thousands of distinct tokens and still finds the skill', async () => {
    const mesh = new MemoryMesh({ dbDir: ':memory:', enableReranker: false, enableYamo: true });
    await mesh.init();
    await mesh.ingestSkill(
      'agent: Long_Query_Probe;\nintent: handle_extremely_long_grounded_prompts;\ncontext:\n  name;Probe;\nhandoff: End;\n',
      { name: 'LongQueryProbe', intent: 'handle_extremely_long_grounded_prompts' });

    // A grounded prompt: an ask, then a long distinct-token body (the kind of text
    // --ground-claude-md produces), well past the size that crashed the daemon.
    let text = 'handle extremely long grounded prompts ';
    let i = 0;
    while (text.length < 60_000) text += `word${i++} of a source block that keeps going `;
    const results = await mesh.searchSkills(text, { limit: 5 });
    assert.ok(results.some((r: any) => r.name === 'LongQueryProbe'),
      'the skill named in the first words of the prompt should still be found');

    // The bounded filter must be one Lance accepts: searchSkills swallows a
    // rejected keyword query and could pass on vector results alone, so ask the
    // table directly with the same expression the fixed code builds.
    const tokens = (mesh as any)._tokenizeQuery(text) as string[];
    assert.ok(tokens.length > 2000, `expected thousands of tokens, got ${tokens.length}`);
    const filter = keywordFilterTokens(tokens)
      .map((t) => `(name LIKE '%${t}%' OR intent LIKE '%${t}%' OR yamo_text LIKE '%${t}%')`)
      .join(' OR ');
    const rows = await (mesh as any).skillTable.query().where(filter).limit(15).toArray();
    assert.ok(rows.some((r: any) => r.name === 'LongQueryProbe'),
      'the capped keyword filter itself should match the skill');
    await mesh.close();
  });

  it('still keyword-matches a token that appears late in a query shorter than the cap', async () => {
    const mesh = new MemoryMesh({ dbDir: ':memory:', enableReranker: false, enableYamo: true });
    await mesh.init();
    await mesh.ingestSkill(
      'agent: Late_Token_Probe;\nintent: rotate_zorblax_credentials;\ncontext:\n  name;Zorblax;\nhandoff: End;\n',
      { name: 'ZorblaxRotator', intent: 'rotate_zorblax_credentials' });
    const results = await mesh.searchSkills('please look at this and then rotate the zorblax credentials', { limit: 5 });
    assert.ok(results.some((r: any) => r.name === 'ZorblaxRotator'));
    await mesh.close();
  });
});
