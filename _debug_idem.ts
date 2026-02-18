import { MemoryMesh } from './lib/memory/memory-mesh.js';
const mesh = new MemoryMesh({ enableYamo: false, enableLLM: false });
await mesh.init();
const l1 = await mesh.distillLesson({
  situation: 'test', errorPattern: 'idempotent_test', oversight: 'test', fix: 'fix',
  preventativeRule: 'rule', severity: 'high', applicableScope: 'TestScope', confidence: 0.9
});
console.log('l1.lessonId:', l1.lessonId, 'patternId:', l1.patternId);
const all = await mesh.getAll({ limit: 100 });
console.log('getAll count:', all.length);
const byPattern = await mesh.getMemoriesByPattern(l1.patternId);
console.log('byPattern count:', byPattern.length);
if (byPattern.length > 0) {
  const meta: any = typeof byPattern[0].metadata === 'string' ? JSON.parse(byPattern[0].metadata) : byPattern[0].metadata;
  console.log('meta.lesson_pattern_id:', meta?.lesson_pattern_id, 'meta.rule_confidence:', meta?.rule_confidence);
}
const l2 = await mesh.distillLesson({
  situation: 'test', errorPattern: 'idempotent_test', oversight: 'test', fix: 'fix',
  preventativeRule: 'rule', severity: 'high', applicableScope: 'TestScope', confidence: 0.5
});
console.log('l2.lessonId:', l2.lessonId);
console.log('IDEMPOTENT?', l1.lessonId === l2.lessonId);
await mesh.close();
