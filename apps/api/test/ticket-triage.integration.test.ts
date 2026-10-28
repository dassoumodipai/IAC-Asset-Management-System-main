import 'reflect-metadata';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Db } from '../src/db';
import { DomainService } from '../src/domain';
import type { AuthRequest } from '../src/security';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Isolated test DB required');
process.env.DATABASE_URL = url;
const db = new Db(),
  service = new DomainService(db);
after(() => db.onModuleDestroy());
test('triage ownership combines category/search/paging and cannot expand employee scope', async () => {
  const users = [];
  for (const role of ['ADMIN', 'IT_ADMIN', 'EMPLOYEE', 'EMPLOYEE']) {
    const id = randomUUID();
    await db.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Synthetic triage')", [
      id,
      `${id}@example.org`,
    ]);
    users.push({ id, roles: [role] });
  }
  const [admin, it, employee, other] = users,
    tag = `triage-${randomUUID()}`;
  const expected = [];
  for (let i = 0; i < 8; i++) {
    const [r] = await db.query(
      "INSERT INTO tickets(reporter_id,owner_id,subject,description,category,priority,created_at) VALUES($1,$2,$3,'Synthetic triage body','HARDWARE','HIGH','2010-01-01'::timestamptz+$4*interval '1 second') RETURNING id",
      [i === 7 ? other.id : employee.id, i < 3 ? null : i < 6 ? it.id : admin.id, tag, i],
    );
    if (i < 3) expected.unshift(r.id);
  }
  const req = (u: any) => ({ user: u }) as AuthRequest;
  let page = await service.tickets(req(it), {
    ownership: 'UNASSIGNED',
    q: tag,
    category: 'HARDWARE',
    priority: 'HIGH',
    limit: 2,
  });
  assert.equal(page.items.length, 2);
  assert.ok(page.nextCursor);
  const next = await service.tickets(req(it), {
    ownership: 'UNASSIGNED',
    q: tag,
    category: 'HARDWARE',
    priority: 'HIGH',
    limit: 2,
    cursor: page.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.equal(next.nextCursor, null);
  assert.deepEqual(
    [...page.items, ...next.items].map((x: any) => x.id),
    expected,
  );
  assert.equal((await service.tickets(req(it), { ownership: 'MINE', q: tag })).items.length, 3);
  assert.equal((await service.tickets(req(admin), { ownership: 'MINE', q: tag })).items.length, 2);
  assert.equal((await service.tickets(req(employee), { q: tag })).items.length, 7);
  await assert.rejects(
    service.tickets(req(employee), { ownership: 'UNASSIGNED', q: tag }),
    /support access/,
  );
  await assert.rejects(
    service.tickets(req(it), { ownership: 'MINE', ownerId: admin.id }),
    /not both/,
  );
  await assert.rejects(service.tickets(req(it), { ownership: 'INVALID' }));
});
