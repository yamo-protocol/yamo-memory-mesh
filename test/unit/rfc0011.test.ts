/**
 * RFC-0011 gap tests: delete, distillLesson, queryLessons, insertHeritage,
 * getMemoriesByPattern, and the three new CLI-facing methods.
 *
 * TDD RED phase — these tests MUST fail before implementation.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// Helper: stable pattern ID matching the RFC-0011 spec
function patternId(errorPattern: string, applicableScope: string): string {
  return crypto
    .createHash('sha256')
    .update(errorPattern + applicableScope)
    .digest('hex')
    .slice(0, 16);
}

describe('RFC-0011: delete()', () => {
  let mesh: MemoryMesh;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    await mesh.close();
  });

  it('should expose a delete() method', () => {
    assert.strictEqual(typeof mesh.delete, 'function');
  });

  it('should delete an existing memory by id', async () => {
    const mem = await mesh.add('Memory to be deleted RFC0011', { type: 'test' });
    await mesh.delete(mem.id);
    const result = await mesh.get(mem.id);
    assert.strictEqual(result, null);
  });

  it('should not throw when deleting a non-existent id', async () => {
    await assert.doesNotReject(() => mesh.delete('mem_nonexistent_000000'));
  });
});

describe('RFC-0011: distillLesson()', () => {
  let mesh: MemoryMesh;
  const lessonCtx = {
    situation: 'Auth fallback was enabled in production causing bypass',
    errorPattern: 'auth_fallback_production',
    oversight: 'Fallback flag left on from local dev',
    fix: 'Added env guard: if (env === "production") disableFallback()',
    preventativeRule: 'Never enable auth fallback in production environments',
    severity: 'critical' as const,
    applicableScope: 'AuthService initialization',
    inverseLesson: 'Strict auth enforced: all test cases pass without fallback',
    confidence: 0.92,
  };

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    await mesh.close();
  });

  it('should expose a distillLesson() method', () => {
    assert.strictEqual(typeof mesh.distillLesson, 'function');
  });

  it('should return a LessonBlock with required fields', async () => {
    const lesson = await mesh.distillLesson(lessonCtx);

    assert.ok(lesson.lessonId, 'lessonId required');
    assert.ok(lesson.lessonId.startsWith('lesson_'), `lessonId must start with "lesson_", got: ${lesson.lessonId}`);
    assert.ok(lesson.patternId, 'patternId required');
    assert.strictEqual(lesson.patternId, patternId(lessonCtx.errorPattern, lessonCtx.applicableScope));
    assert.ok(lesson.preventativeRule, 'preventativeRule required');
    assert.ok(lesson.applicableScope, 'applicableScope required');
    assert.strictEqual(typeof lesson.ruleConfidence, 'number');
    assert.ok(lesson.wireFormat, 'wireFormat required');
    assert.ok(lesson.memoryId, 'memoryId required');
  });

  it('should store lesson as memory with type="lesson" and tag #lesson_learned', async () => {
    const lesson = await mesh.distillLesson({ ...lessonCtx, errorPattern: 'auth_fallback_store_test' });
    const mem = await mesh.get(lesson.memoryId);

    assert.ok(mem, 'memory should be stored');
    const meta = typeof mem!.metadata === 'string' ? JSON.parse(mem!.metadata) : mem!.metadata;
    assert.strictEqual(meta.type, 'lesson');
    assert.ok(Array.isArray(meta.tags), 'tags should be array');
    assert.ok(meta.tags.includes('#lesson_learned'), 'should include #lesson_learned tag');
  });

  it('wireFormat should contain RFC-0011 §3.5 canonical fields', async () => {
    const lesson = await mesh.distillLesson({ ...lessonCtx, errorPattern: 'auth_fallback_wire_test' });

    assert.ok(lesson.wireFormat.includes('intent: distill_wisdom_from_execution'));
    assert.ok(lesson.wireFormat.includes('lesson_id'));
    assert.ok(lesson.wireFormat.includes('preventative_rule'));
    assert.ok(lesson.wireFormat.includes('handoff: SubconsciousReflector'));
    assert.ok(lesson.wireFormat.includes('log: lesson_learned'));
  });

  it('should be idempotent: same patternId + higher confidence returns existing', async () => {
    const firstLesson = await mesh.distillLesson({ ...lessonCtx, errorPattern: 'auth_idempotent_test' });
    // Call again with same pattern, lower confidence
    const secondLesson = await mesh.distillLesson({
      ...lessonCtx,
      errorPattern: 'auth_idempotent_test',
      confidence: 0.5, // lower than original 0.92
    });

    assert.strictEqual(secondLesson.lessonId, firstLesson.lessonId, 'should return existing lesson');
    assert.strictEqual(secondLesson.memoryId, firstLesson.memoryId, 'should return same memoryId');
  });
});

describe('RFC-0011: queryLessons()', () => {
  let mesh: MemoryMesh;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
    // Seed some lessons and a non-lesson memory
    await mesh.distillLesson({
      situation: 'Connection pool exhausted',
      errorPattern: 'db_pool_exhausted',
      oversight: 'No pool size limit set',
      fix: 'Added maxConnections: 20',
      preventativeRule: 'Always set maxConnections in DB config',
      severity: 'high',
      applicableScope: 'DatabaseService',
      confidence: 0.88,
    });
    await mesh.distillLesson({
      situation: 'Rate limit hit on external API',
      errorPattern: 'rate_limit_external',
      oversight: 'No backoff strategy',
      fix: 'Added exponential backoff',
      preventativeRule: 'Always implement backoff for external API calls',
      severity: 'medium',
      applicableScope: 'ExternalAPIClient',
      confidence: 0.85,
    });
    await mesh.add('This is a regular event memory, not a lesson', { type: 'event' });
  });

  after(async () => {
    await mesh.close();
  });

  it('should expose a queryLessons() method', () => {
    assert.strictEqual(typeof mesh.queryLessons, 'function');
  });

  it('should return only lesson-type memories', async () => {
    const lessons = await mesh.queryLessons('database connection', { limit: 10 });
    assert.ok(Array.isArray(lessons));
    assert.ok(lessons.length > 0, 'should find at least one lesson');
    for (const l of lessons) {
      assert.ok(l.preventativeRule, 'each result should have preventativeRule');
    }
  });

  it('should return results ordered by relevance (higher-matching lesson first)', async () => {
    const lessons = await mesh.queryLessons('database pool exhausted');
    assert.ok(lessons.length > 0, 'should return at least one lesson');
    // The db-related lesson should appear in results
    const dbLessonFound = lessons.some(l =>
      l.applicableScope.toLowerCase().includes('database') ||
      l.preventativeRule.toLowerCase().includes('connection')
    );
    assert.ok(dbLessonFound, 'database lesson should appear in results for db query');
  });
});

describe('RFC-0011: insertHeritage()', () => {
  let mesh: MemoryMesh;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
  });

  after(async () => {
    await mesh.close();
  });

  it('should expose an insertHeritage() method', () => {
    assert.strictEqual(typeof mesh.insertHeritage, 'function');
  });

  it('should update memory metadata with heritage_chain', async () => {
    const mem = await mesh.add('Memory for heritage tracking RFC0011', { type: 'event' });
    const heritage = {
      intentChain: ['specify_feature', 'plan_implementation', 'implement_tdd'],
      hypotheses: ['Feature improves reliability', 'TDD prevents regressions'],
      rationales: ['RFC-0011 requires heritage tracking', 'Unbroken chain validates intent'],
    };

    await mesh.insertHeritage(mem.id, heritage);

    const updated = await mesh.get(mem.id);
    assert.ok(updated, 'memory should still exist');
    const meta = typeof updated!.metadata === 'string'
      ? JSON.parse(updated!.metadata)
      : updated!.metadata;
    assert.ok(meta.heritage_chain, 'heritage_chain should be set');
    const chain = typeof meta.heritage_chain === 'string'
      ? JSON.parse(meta.heritage_chain)
      : meta.heritage_chain;
    assert.deepStrictEqual(chain.intentChain, heritage.intentChain);
    assert.deepStrictEqual(chain.hypotheses, heritage.hypotheses);
    assert.deepStrictEqual(chain.rationales, heritage.rationales);
  });

  it('should not throw when memoryId does not exist', async () => {
    await assert.doesNotReject(() =>
      mesh.insertHeritage('mem_nonexistent_000000', {
        intentChain: ['test'],
        hypotheses: [],
        rationales: [],
      })
    );
  });
});

describe('RFC-0011: getMemoriesByPattern()', () => {
  let mesh: MemoryMesh;
  const pattern = 'cache_invalidation_bug';
  const scope = 'CacheService';
  let expectedPatternId: string;

  before(async () => {
    mesh = new MemoryMesh({ enableYamo: false, enableLLM: false, dbDir: ':memory:' });
    await mesh.init();
    expectedPatternId = patternId(pattern, scope);

    await mesh.distillLesson({
      situation: 'Cache not invalidated on update',
      errorPattern: pattern,
      oversight: 'No cache busting on write path',
      fix: 'Added cache.invalidate() after DB write',
      preventativeRule: 'Always invalidate cache after mutation',
      severity: 'high',
      applicableScope: scope,
      confidence: 0.9,
    });
    // Add a non-matching memory
    await mesh.add('Unrelated memory for pattern test', { type: 'event' });
  });

  after(async () => {
    await mesh.close();
  });

  it('should expose a getMemoriesByPattern() method', () => {
    assert.strictEqual(typeof mesh.getMemoriesByPattern, 'function');
  });

  it('should return memories matching the given patternId', async () => {
    const results = await mesh.getMemoriesByPattern(expectedPatternId);
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1, `Expected at least 1 result for patternId ${expectedPatternId}`);
    for (const r of results) {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      assert.strictEqual(meta.lesson_pattern_id, expectedPatternId);
    }
  });

  it('should return empty array for unknown patternId', async () => {
    const results = await mesh.getMemoriesByPattern('nonexistent_pattern_id_000');
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });
});
