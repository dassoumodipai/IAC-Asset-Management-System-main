import 'reflect-metadata';
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main';
import { Db } from '../src/db';
import { DomainService } from '../src/domain';
import { FinanceService } from '../src/finance';
import { configuration, hash, signedCsrf, token } from '../src/config';
import type { AuthRequest } from '../src/security';
const connection = process.env.TEST_DATABASE_URL;
if (connection && !new URL(connection).pathname.endsWith('_test'))
  throw new Error('Finance tests require isolated _test database');
describe(
  'Finance workflow, permissions and approved snapshot integration',
  { skip: !connection, concurrency: false },
  () => {
    let app: INestApplication, db: Db, domain: DomainService, finance: FinanceService, base: string;
    let admin: any,
      reviewer: any,
      second: any,
      executive: any,
      employee: any,
      itAdmin: any,
      dual: any,
      asset: any;
    const tag = `fin-${randomUUID()}`;
    const req = (user: any, version?: number) =>
      ({
        user,
        get: (name: string) =>
          name.toLowerCase() === 'if-match' && version !== undefined
            ? `"${version}"`
            : name.toLowerCase() === 'idempotency-key'
              ? randomUUID()
              : undefined,
      }) as AuthRequest;
    async function call(user: any, path: string, body?: unknown, version?: number, csrf = true) {
      const r = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: configuration().origin,
          ...(user
            ? {
                Cookie: `${configuration().sessionCookie}=${user.session}; ${configuration().csrfCookie}=${user.csrf}`,
              }
            : {}),
          ...(body !== undefined
            ? {
                'Content-Type': 'application/json',
                ...(csrf ? { 'X-CSRF-Token': user?.csrf } : {}),
                ...(version === undefined ? {} : { 'If-Match': `"${version}"` }),
              }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    }
    const approval = {
      decision: 'APPROVE',
      reason: 'Invoice and asset details independently checked',
      purchaseCost: '12500.50',
      purchaseDate: '2026-01-05',
      invoiceNumber: 'SYNTHETIC-INV-1',
      supplier: 'Synthetic Supplier',
    };
    before(async () => {
      process.env.DATABASE_URL = connection;
      app = await createApp();
      await app.listen(0, '127.0.0.1');
      base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
      db = app.get(Db);
      domain = app.get(DomainService);
      finance = app.get(FinanceService);
      async function user(roles: string[]) {
        const u = {
          id: randomUUID(),
          email: `${tag}-${randomUUID()}@example.org`,
          displayName: `Synthetic ${roles.join(' ')}`,
          roles,
          csrf: signedCsrf(),
          session: token(),
        };
        await db.query(
          `INSERT INTO users(id,email,display_name,state,email_verified_at,portal_accepted_at,portal_notice_version,mfa_enrolled_at) VALUES($1,$2,$3,'ACTIVE',now(),now(),$4,now())`,
          [u.id, u.email, u.displayName, configuration().noticeVersion],
        );
        for (const r of roles)
          await db.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [u.id, r]);
        await db.query(
          `INSERT INTO sessions(id_hash,user_id,csrf_hash,expires_at,mfa_verified_at) VALUES($1,$2,$3,now()+interval '1 hour',now())`,
          [hash(u.session), u.id, hash(u.csrf)],
        );
        return u;
      }
      admin = await user(['ADMIN']);
      reviewer = await user(['FINANCE']);
      second = await user(['FINANCE']);
      executive = await user(['EXECUTIVE']);
      employee = await user(['EMPLOYEE']);
      itAdmin = await user(['IT_ADMIN']);
      dual = await user(['ADMIN', 'FINANCE']);
      const refs: any = {};
      for (const kind of ['CATEGORY', 'ASSET_TYPE', 'OWNERSHIP', 'CONDITION', 'RISK']) {
        refs[kind] = `${tag}-${kind}`;
        await db.query('INSERT INTO reference_values(kind,code,label) VALUES($1,$2,$2)', [
          kind,
          refs[kind],
        ]);
      }
      asset = await domain.createAsset(req(admin), {
        category: refs.CATEGORY,
        assetType: refs.ASSET_TYPE,
        description: `${tag} test asset`,
        ownershipType: refs.OWNERSHIP,
        status: 'In Store',
        condition: refs.CONDITION,
        riskLevel: refs.RISK,
        amcApplies: false,
      });
    });
    after(async () => {
      await app?.close();
    });
    it('denies anonymous, employee, IT and executive queue access; executive cannot mutate', async () => {
      for (const u of [null, employee, itAdmin, executive])
        assert.equal((await call(u, '/finance/queue')).status, u ? 403 : 401);
      for (const u of [employee, itAdmin, executive, reviewer])
        assert.equal(
          (
            await call(
              u,
              `/finance/assets/${asset.id}/submit`,
              { reason: 'Synthetic submission' },
              asset.version,
            )
          ).status,
          403,
        );
      assert.equal((await call(executive, '/finance/executive-summary')).status, 200);
      for (const u of [employee, itAdmin])
        assert.equal((await call(u, '/finance/executive-summary')).status, 403);
    });
    it('requires Finance/Executive MFA without inheriting all-ticket internal-note access', async () => {
      await db.query('UPDATE sessions SET mfa_verified_at=NULL WHERE user_id=$1', [executive.id]);
      assert.equal((await call(executive, '/finance/executive-summary')).status, 403);
      await db.query('UPDATE sessions SET mfa_verified_at=now() WHERE user_id=$1', [executive.id]);
      const [{ id }] = await db.query(
        `INSERT INTO tickets(reporter_id,subject,description,category,priority) VALUES($1,$2,'Synthetic private ticket','OTHER','LOW') RETURNING id`,
        [employee.id, tag],
      );
      assert.equal((await call(reviewer, `/tickets/${id}`)).status, 404);
      assert.equal((await call(executive, `/tickets/${id}`)).status, 404);
    });
    it('validates reason, If-Match and CSRF before submission and rejects direct approval', async () => {
      const path = `/finance/assets/${asset.id}/submit`;
      assert.equal((await call(admin, path, { reason: '' }, asset.version)).status, 422);
      assert.equal((await call(admin, path, { reason: 'Synthetic submission' })).status, 428);
      assert.equal(
        (await call(admin, path, { reason: 'Synthetic submission' }, asset.version, false)).status,
        403,
      );
      assert.equal(
        (await call(reviewer, `/finance/assets/${asset.id}/review`, approval, 1)).status,
        409,
      );
      assert.equal(
        (await db.query('SELECT * FROM asset_finance WHERE asset_id=$1', [asset.id])).length,
        0,
      );
    });
    it('submits, returns, resubmits and approves with complete history and controlled amendments', async () => {
      const submit = () =>
        finance.submit(req(admin, asset.version), asset.id, { reason: 'Synthetic invoice review' });
      let record = await submit();
      assert.equal(record.state, 'SUBMITTED');
      assert.equal(record.financeVersion, 1);
      assert.equal(
        (await call(admin, `/finance/assets/${asset.id}/review`, approval, 1)).status,
        403,
      );
      await assert.rejects(submit(), /already awaiting/);
      await assert.rejects(
        domain.editAsset(req(admin, asset.version), asset.id, {
          purchaseCost: '999',
          reason: 'Must not bypass review',
        }),
        /Finance submission/,
      );
      let r = await call(
        reviewer,
        `/finance/assets/${asset.id}/review`,
        { decision: 'APPROVE', reason: 'Missing fields' },
        1,
      );
      assert.equal(r.status, 422);
      r = await call(
        reviewer,
        `/finance/assets/${asset.id}/review`,
        { ...approval, purchaseDate: '2099-01-01' },
        1,
      );
      assert.equal(r.status, 422);
      r = await call(
        reviewer,
        `/finance/assets/${asset.id}/review`,
        { decision: 'RETURN', reason: 'Invoice reference needs correction' },
        1,
      );
      assert.equal(r.status, 201);
      assert.equal(r.body.state, 'RETURNED');
      record = await submit();
      assert.equal(record.state, 'SUBMITTED');
      r = await call(
        reviewer,
        `/finance/assets/${asset.id}/review`,
        approval,
        record.financeVersion - 1,
      );
      assert.equal(r.status, 412);
      r = await call(
        reviewer,
        `/finance/assets/${asset.id}/review`,
        approval,
        record.financeVersion,
      );
      assert.equal(r.status, 201);
      record = r.body;
      asset.version = record.assetVersion;
      assert.equal(record.state, 'APPROVED');
      assert.equal(record.approvedCost, '12500.50');
      assert.equal(record.history.length, 4);
      const [dbAsset] = await db.query(
        'SELECT purchase_cost,finance_pending FROM assets WHERE id=$1',
        [asset.id],
      );
      assert.equal(dbAsset.purchase_cost, '12500.50');
      assert.equal(dbAsset.finance_pending, false);
      const before = await finance.executive(req(executive));
      record = await submit();
      const during = await finance.executive(req(executive));
      assert.equal(during.approvedAcquisitionCost, before.approvedAcquisitionCost);
      assert.equal(during.approvedAssets, before.approvedAssets);
      r = await call(
        second,
        `/finance/assets/${asset.id}/review`,
        { ...approval, purchaseCost: '13000.25', reason: 'Corrected invoice total' },
        record.financeVersion,
      );
      assert.equal(r.status, 201);
      asset.version = r.body.assetVersion;
      const after = await finance.executive(req(executive));
      assert.equal(
        Number(after.approvedAcquisitionCost) - Number(before.approvedAcquisitionCost),
        499.75,
      );
    });
    it('rejects stale submitted asset version and requires resubmission', async () => {
      let record = await finance.submit(req(admin, asset.version), asset.id, {
        reason: 'New synthetic amendment',
      });
      asset = await domain.editAsset(req(admin, asset.version), asset.id, {
        description: `${tag} updated technical description`,
        reason: 'Synthetic catalog correction',
      });
      assert.equal(
        (
          await call(
            reviewer,
            `/finance/assets/${asset.id}/review`,
            approval,
            record.financeVersion,
          )
        ).status,
        409,
      );
      record = await finance.submit(req(admin, asset.version), asset.id, {
        reason: 'Current catalog version resubmitted',
      });
      assert.equal(
        (
          await call(
            reviewer,
            `/finance/assets/${asset.id}/review`,
            approval,
            record.financeVersion,
          )
        ).status,
        201,
      );
      asset = await domain.asset(req(admin), asset.id);
    });
    it('forbids self-approval even with combined Admin and Finance roles', async () => {
      const record = await finance.submit(req(dual, asset.version), asset.id, {
        reason: 'Combined-role separation regression',
      });
      assert.equal(
        (await call(dual, `/finance/assets/${asset.id}/review`, approval, record.financeVersion))
          .status,
        403,
      );
    });
    it('serializes simultaneous Finance reviewers into one decision', async () => {
      const record = await finance.detail(req(reviewer), asset.id);
      const result = await Promise.all(
        [reviewer, second].map((u) =>
          call(u, `/finance/assets/${asset.id}/review`, approval, record.financeVersion),
        ),
      );
      assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
      const latest = await finance.detail(req(admin), asset.id);
      asset.version = latest.assetVersion;
      assert.equal(latest.history.filter((e: any) => e.action === 'APPROVED').length, 4);
    });
    it('pages deterministic queue, validates filters and exposes only summary fields to executives', async () => {
      const page = await call(admin, `/finance/queue?state=ALL&q=${tag}&limit=1`);
      assert.equal(page.status, 200);
      assert.equal(page.body.items.length, 1);
      assert.equal((await call(admin, '/finance/queue?state=INVENTED')).status, 422);
      assert.equal((await call(admin, '/finance/queue?limit=10000')).status, 422);
      const summary = await call(executive, '/finance/executive-summary');
      assert.equal(summary.status, 200);
      assert.equal(summary.body.currency, 'INR');
      assert.match(summary.body.definitions.approvedAcquisitionCost, /Not net book value/);
      assert.ok(!JSON.stringify(summary.body).includes(employee.email));
    });
    it('combines department and asset-type filters across stable queue pages', async () => {
      const [{ id: departmentId }] = await db.query(
        'INSERT INTO departments(code,name) VALUES($1,$1) RETURNING id',
        [`queue-${randomUUID()}`],
      );
      const ids = await db.query(
        `INSERT INTO assets(asset_code,category,asset_type,description,ownership_type,status,condition,risk_level,department_id,created_by)
        SELECT 'IAC-IT-'||lpad(nextval('asset_number_seq')::text,6,'0'),'IT Hardware',CASE WHEN i<=4 THEN 'Laptop' ELSE 'Mouse' END,'Synthetic filtered queue','Owned','In Store','Good','Low',$1,$2 FROM generate_series(1,6)i RETURNING id,asset_code`,
        [departmentId, admin.id],
      );
      const options = await call(reviewer, '/finance/filter-options');
      assert.equal(options.status, 200);
      assert.ok(options.body.values.some((v: any) => v.code === 'Mouse'));
      assert.ok(options.body.departments.some((d: any) => d.id === departmentId));
      for (const u of [employee, itAdmin, executive])
        assert.equal((await call(u, '/finance/filter-options')).status, 403);
      const prefix = `/finance/queue?state=UNSUBMITTED&departmentId=${departmentId}&assetType=Laptop&limit=2`;
      const first = await call(reviewer, prefix);
      assert.equal(first.status, 200);
      assert.equal(first.body.items.length, 2);
      assert.ok(first.body.nextCursor);
      const secondPage = await call(reviewer, prefix + '&after=' + first.body.nextCursor);
      assert.equal(secondPage.body.items.length, 2);
      assert.equal(secondPage.body.nextCursor, null);
      assert.deepEqual(
        [...first.body.items, ...secondPage.body.items].map((a: any) => a.id),
        ids.slice(0, 4).map((a) => a.id),
      );
      for (const a of first.body.items) {
        assert.equal(a.departmentId, departmentId);
        assert.equal(a.assetType, 'Laptop');
      }
      assert.equal((await call(reviewer, '/finance/queue?departmentId=bad')).status, 422);
      assert.equal(
        (await call(reviewer, '/finance/queue?assetType=' + encodeURIComponent('x'.repeat(101))))
          .status,
        422,
      );
      for (const u of [employee, itAdmin, executive])
        assert.equal((await call(u, prefix)).status, 403);
      await db.query('UPDATE departments SET active=false WHERE id=$1', [departmentId]);
      assert.equal((await call(admin, prefix)).body.items.length, 2);
    });
    it('handles concurrent role-isolated HTTP reads while Finance evidence remains unchanged', async () => {
      const before = await finance.detail(req(admin), asset.id);
      const requests = Array.from({ length: 40 }, (_, i) =>
        i % 4 === 0
          ? call(executive, '/finance/executive-summary')
          : i % 4 === 1
            ? call(reviewer, `/finance/assets/${asset.id}`)
            : i % 4 === 2
              ? call(employee, `/finance/assets/${asset.id}`)
              : call(itAdmin, '/finance/queue'),
      );
      const responses = await Promise.all(requests);
      for (const [i, r] of responses.entries()) assert.equal(r.status, i % 4 < 2 ? 200 : 403);
      const after = await finance.detail(req(admin), asset.id);
      assert.equal(after.financeVersion, before.financeVersion);
      assert.equal(after.assetVersion, before.assetVersion);
      assert.deepEqual(after.history, before.history);
    });
    it('executive warranty window explicitly uses the organization date', async () => {
      const original = db.query.bind(db);
      let predicate = '';
      db.query = async (sql: string, values: any[] = [], client?: any) => {
        if (sql.includes('AS warranty_expiring')) predicate = sql;
        return original(sql, values, client);
      };
      let report: any;
      try {
        report = await finance.executive(req(executive));
      } finally {
        db.query = original;
      }
      assert.match(
        predicate,
        /warranty_expiry BETWEEN \(now\(\) AT TIME ZONE 'Asia\/Kolkata'\)::date/,
      );
      const [expected] = await db.query(
        `SELECT count(*)::int AS n FROM assets WHERE warranty_expiry BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date AND (now() AT TIME ZONE 'Asia/Kolkata')::date+30`,
      );
      assert.equal(report.warrantyExpiring, expected.n);
    });
    it('executive totals and department breakdown share one database snapshot during writes', async () => {
      const original = db.query.bind(db);
      let inserted = false;
      const departmentName = `snapshot-${randomUUID()}`;
      db.query = async (sql: string, values: any[] = [], client?: any) => {
        const rows = await original(sql, values, client);
        if (!inserted && sql.includes('AS total_assets')) {
          inserted = true;
          // A separate committed writer lands between the summary queries.
          const writer = await db.pool.connect();
          try {
            const [{ id }] = (
              await writer.query('INSERT INTO departments(code,name) VALUES($1,$1) RETURNING id', [
                departmentName,
              ])
            ).rows;
            await writer.query(
              `INSERT INTO assets(asset_code,category,asset_type,description,ownership_type,status,condition,risk_level,department_id,created_by)
              VALUES('IAC-IT-'||lpad(nextval('asset_number_seq')::text,6,'0'),'IT Hardware','Laptop','Synthetic snapshot race','Owned','In Store','Good','Low',$1,$2)`,
              [id, admin.id],
            );
          } finally {
            writer.release();
          }
        }
        return rows;
      };
      let snapshot: any;
      try {
        snapshot = await finance.executive(req(executive));
      } finally {
        db.query = original;
      }
      assert.equal(inserted, true);
      assert.equal(
        snapshot.departments.some((d: any) => d.department === departmentName),
        false,
      );
      const now = await finance.executive(req(executive));
      assert.equal(now.totalAssets, snapshot.totalAssets + 1);
    });
    it('pages full Finance evidence with tied microsecond timestamps and asset-scoped cursors', async () => {
      await db.query(
        `INSERT INTO asset_finance_events(asset_id,action,actor_id,reason,finance_version,occurred_at)
        SELECT $1,'SUBMITTED',$2,'Synthetic old history '||i,i,'2010-01-01 00:00:00.123456+00'::timestamptz
        FROM generate_series(1,57) i`,
        [asset.id, admin.id],
      );
      const expected = await db.query(
        'SELECT id FROM asset_finance_events WHERE asset_id=$1 ORDER BY occurred_at DESC,id DESC',
        [asset.id],
      );
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const r = await call(
          reviewer,
          `/finance/assets/${asset.id}/history?limit=7${cursor ? '&before=' + cursor : ''}`,
        );
        assert.equal(r.status, 200);
        seen.push(...r.body.items.map((e: any) => e.id));
        cursor = r.body.nextCursor;
      } while (cursor);
      assert.deepEqual(
        seen,
        expected.map((e) => e.id),
      );
      assert.equal(new Set(seen).size, expected.length);
      for (const u of [employee, itAdmin, executive])
        assert.equal((await call(u, `/finance/assets/${asset.id}/history`)).status, 403);
      assert.equal(
        (await call(admin, `/finance/assets/${asset.id}/history?limit=101`)).status,
        422,
      );
      assert.equal(
        (await call(admin, `/finance/assets/${asset.id}/history?before=invalid`)).status,
        422,
      );
      assert.equal(
        (await call(admin, `/finance/assets/${asset.id}/history?before=${randomUUID()}`)).status,
        404,
      );
      assert.equal((await call(admin, `/finance/assets/${randomUUID()}/history`)).status, 404);
    });
    it('finance history is append-only at the database boundary', async () => {
      await assert.rejects(
        db.query(`UPDATE asset_finance_events SET reason='changed' WHERE asset_id=$1`, [asset.id]),
        /append only/,
      );
    });
  },
);
