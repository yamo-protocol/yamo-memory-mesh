import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

describe('MemoryMesh - Hybrid Search Skills', () => {
  it('should retrieve ingested skills using hybrid search', async () => {
    const mesh = new MemoryMesh({
      dbDir: ':memory:',
      enableReranker: false,
      enableYamo: true
    });
    await mesh.init();

    // Ingest two sample skills
    const skillA = `agent: MemoryMesh_Architect;
intent: design_system_architecture;
context:
  name;Architect;
output:
  schema;v2;
handoff: End;
`;
    const skillB = `agent: MemoryMesh_Developer;
intent: implement_code_logic;
context:
  name;Developer;
output:
  language;TypeScript;
handoff: End;
`;

    await mesh.ingestSkill(skillA, { name: 'Architect', intent: 'design_system_architecture' });
    await mesh.ingestSkill(skillB, { name: 'Developer', intent: 'implement_code_logic' });

    // 1. Explicit search
    const explicitResults = await mesh.searchSkills('Architect: design system');
    assert.ok(explicitResults.length >= 1);
    assert.strictEqual(explicitResults[0].name, 'Architect');
    assert.strictEqual(explicitResults[0].score, 1.0);

    // 2. Keyword/Hybrid search
    const hybridResults = await mesh.searchSkills('implement code');
    assert.ok(hybridResults.length >= 1);
    assert.strictEqual(hybridResults[0].name, 'Developer');
    assert.ok(hybridResults[0].score > 0);
  });
});
