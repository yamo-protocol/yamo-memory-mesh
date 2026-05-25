import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryMesh } from '../../lib/memory/memory-mesh.js';

// AGP Phase 3b.1 — staged synthesis. A staged skill must be neither on the live
// skill path nor index-discoverable until the kernel's κ operator commits it.
describe('MemoryMesh - synthesis staging (Phase 3b.1)', () => {
  function newMesh(liveDir: string) {
    return new MemoryMesh({
      dbDir: ':memory:',
      enableReranker: false,
      enableYamo: true,
      skill_directories: liveDir,
    });
  }

  // Fake SkillCreator: writes a skill file (with frontmatter, so synthesize takes
  // the single-write path) into whatever skillDirectories[0] currently is — mirroring
  // the real agent, which resolves its write target from the shared skill dirs.
  function fakeSkillCreator(mesh: MemoryMesh, fileName: string) {
    return async () => {
      const target = mesh.skillDirectories[0];
      fs.writeFileSync(
        path.join(target, fileName),
        `---\nname: StagedSkill\nversion: 1.0.0\nintent: do_a_thing\n---\nagent: Staged;\nintent: do_a_thing;\nhandoff: End;\n`,
        'utf8',
      );
      return { ok: true };
    };
  }

  it('defers file + DB write to the staging dir, restores skillDir, then commits on flush', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yamo-staging-'));
    const liveDir = path.join(tmp, 'live');
    const stagingDir = path.join(tmp, 'staging');
    fs.mkdirSync(liveDir, { recursive: true });

    const mesh = newMesh(liveDir);
    await mesh.init();
    mesh._kernel_execute = fakeSkillCreator(mesh, 'staged-skill.md');

    const beforeCount = (await mesh.listSkills()).length;

    const result: any = await mesh.synthesize({
      topic: 'staged_test',
      stagingSkillDir: stagingDir,
      ingest: 'stage',
    });

    // 1. file landed under the staging dir, NOT the live dir
    assert.strictEqual(result.status, 'success');
    assert.ok(result.stagingPath, 'returns stagingPath');
    assert.ok(
      result.stagingPath.startsWith(stagingDir),
      `stagingPath ${result.stagingPath} should be under ${stagingDir}`,
    );
    assert.ok(fs.existsSync(result.stagingPath), 'staged file exists on disk');
    assert.deepStrictEqual(
      fs.readdirSync(liveDir).filter((f) => f.endsWith('.md')),
      [],
      'live skill dir has no .md files before commit',
    );

    // 2. DB write deferred — pendingIngest returned, nothing indexed yet
    assert.ok(result.pendingIngest?.record, 'returns pendingIngest.record');
    assert.strictEqual(
      (await mesh.listSkills()).length,
      beforeCount,
      'no synthesized_skills row before commit',
    );
    assert.strictEqual(
      await mesh.getSkill(result.skill_id),
      null,
      'staged skill is not discoverable before commit',
    );

    // 3. live skill path restored after the staging window
    assert.strictEqual(mesh.skillDirectories[0], liveDir, 'skillDirectories[0] restored');

    // 4. commit flushes the deferred row
    await mesh.commitPendingIngest(result.pendingIngest);
    assert.strictEqual(
      (await mesh.listSkills()).length,
      beforeCount + 1,
      'row indexed after commit',
    );
    const committed = await mesh.getSkill(result.skill_id);
    assert.ok(committed, 'skill discoverable after commit');
    assert.strictEqual(committed.name, result.skill_name);
  });

  it('rewrites source_file to the committed path when finalSourceFile is given', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yamo-staging-fsf-'));
    const liveDir = path.join(tmp, 'live');
    const stagingDir = path.join(tmp, 'staging');
    fs.mkdirSync(liveDir, { recursive: true });

    const mesh = newMesh(liveDir);
    await mesh.init();
    mesh._kernel_execute = fakeSkillCreator(mesh, 'staged-skill.md');

    const result: any = await mesh.synthesize({
      topic: 'fsf_test',
      stagingSkillDir: stagingDir,
      ingest: 'stage',
    });

    const finalPath = path.join(liveDir, 'staged-skill.md');
    await mesh.commitPendingIngest(result.pendingIngest, { finalSourceFile: finalPath });

    const committed = await mesh.getSkill(result.skill_id);
    assert.strictEqual(committed.metadata.source_file, finalPath, 'source_file points at committed path');
  });

  it('commit mode (default) indexes the skill immediately', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yamo-commit-'));
    const liveDir = path.join(tmp, 'live');
    fs.mkdirSync(liveDir, { recursive: true });

    const mesh = newMesh(liveDir);
    await mesh.init();
    mesh._kernel_execute = fakeSkillCreator(mesh, 'committed-skill.md');

    const result: any = await mesh.synthesize({ topic: 'commit_test' });

    assert.strictEqual(result.status, 'success');
    assert.strictEqual(result.pendingIngest, undefined, 'no pendingIngest in commit mode');
    assert.ok(await mesh.getSkill(result.skill_id), 'committed immediately');
    assert.strictEqual(mesh.skillDirectories[0], liveDir, 'skill dir unchanged when not staging');
  });
});
