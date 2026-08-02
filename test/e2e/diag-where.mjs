// DIAG (debug/e2e-getbyid-ci): dump stored ids and probe WHERE-vs-scan.
import * as lancedb from '@lancedb/lancedb';
const [, , dir, id] = process.argv;
const db = await lancedb.connect(dir);
const t = await db.openTable('memory_entries');
const all = await t.query().toArray();
console.log('SCAN rows:', all.length, 'ids:', JSON.stringify(all.map((r) => r.id)));
console.log('target id:', JSON.stringify(id));
for (const expr of [`id == '${id}'`, `id = '${id}'`]) {
  try {
    const hit = await t.query().where(expr).toArray();
    console.log(`WHERE ${expr} -> ${hit.length} hits`);
  } catch (e) {
    console.log(`WHERE ${expr} -> THREW: ${e.message}`);
  }
}
