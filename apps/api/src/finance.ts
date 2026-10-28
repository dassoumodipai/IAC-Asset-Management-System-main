import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { AuthRequest, SessionGuard, requireRole, assertVersion } from './security';
import { assetPatch, camel, validateAsset } from './domain-helpers';

const reasonInput = z.object({ reason: z.string().trim().min(3).max(2000) }).strict();
const reviewInput = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    reason: z.string().trim().min(3).max(2000),
    purchaseCost: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/)
      .optional(),
    purchaseDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    invoiceNumber: z.string().trim().min(1).max(500).optional(),
    supplier: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'APPROVE')
      for (const key of ['purchaseCost', 'purchaseDate', 'invoiceNumber', 'supplier'] as const)
        if (!v[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'Required for Finance approval' });
    if (
      v.decision === 'RETURN' &&
      [v.purchaseCost, v.purchaseDate, v.invoiceNumber, v.supplier].some((v) => v !== undefined)
    )
      ctx.addIssue({ code: 'custom', message: 'Return requests must not change financial fields' });
  });
const queueInput = z
  .object({
    state: z.enum(['ALL', 'UNSUBMITTED', 'SUBMITTED', 'RETURNED', 'APPROVED']).default('SUBMITTED'),
    q: z.string().trim().max(100).optional(),
    after: z.string().max(100).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
@Injectable()
export class FinanceService {
  constructor(@Inject(Db) private readonly db: Db) {}
  async queue(req: AuthRequest, query: unknown) {
    requireRole(req, 'ADMIN', 'FINANCE');
    const p = queueInput.parse(query),
      values: any[] = [],
      where: string[] = [];
    if (p.state === 'UNSUBMITTED') where.push('f.asset_id IS NULL');
    else if (p.state !== 'ALL') {
      values.push(p.state);
      where.push(`f.state=$${values.length}`);
    }
    if (p.q) {
      values.push(p.q);
      where.push(
        `(strpos(lower(a.asset_code),lower($${values.length}))>0 OR strpos(lower(a.description),lower($${values.length}))>0)`,
      );
    }
    if (p.after) {
      values.push(p.after);
      where.push(`a.asset_code>$${values.length}`);
    }
    values.push(p.limit + 1);
    const rows = await this.db.query(
      `SELECT a.id,a.asset_code,a.description,a.asset_type,a.version AS asset_version,a.purchase_cost,a.purchase_date,a.invoice_number,a.supplier,a.finance_pending,
      f.state,f.version AS finance_version,f.submitted_at,f.review_reason,f.approved_cost,f.approved_at,
      submitter.display_name AS submitted_by_name
      FROM assets a LEFT JOIN asset_finance f ON f.asset_id=a.id LEFT JOIN users submitter ON submitter.id=f.submitted_by
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.asset_code LIMIT $${values.length}`,
      values,
    );
    const items = rows.slice(0, p.limit).map(camel);
    return { items, nextCursor: rows.length > p.limit ? items.at(-1).assetCode : null };
  }
  async detail(req: AuthRequest, value: string) {
    requireRole(req, 'ADMIN', 'FINANCE');
    const id = z.string().uuid().parse(value);
    const [row] = await this.db.query(
      `SELECT a.id,a.asset_code,a.description,a.asset_type,a.version AS asset_version,a.purchase_cost,a.purchase_date,a.invoice_number,a.supplier,a.currency,a.finance_pending,
      f.state,f.version AS finance_version,f.asset_version AS submitted_asset_version,f.submitted_by,f.submitted_at,f.submission_reason,f.reviewed_at,f.review_reason,f.approved_cost,f.approved_at,
      s.display_name AS submitted_by_name,r.display_name AS reviewed_by_name
      FROM assets a LEFT JOIN asset_finance f ON f.asset_id=a.id LEFT JOIN users s ON s.id=f.submitted_by LEFT JOIN users r ON r.id=f.reviewed_by WHERE a.id=$1`,
      [id],
    );
    if (!row) throw new NotFoundException('Asset not found');
    const history = await this.db.query(
      'SELECT e.id,e.action,e.reason,e.finance_version,e.details,e.occurred_at,u.display_name AS actor FROM asset_finance_events e JOIN users u ON u.id=e.actor_id WHERE e.asset_id=$1 ORDER BY e.occurred_at DESC,e.id DESC LIMIT 50',
      [id],
    );
    return { ...camel(row), history: history.map(camel) };
  }
  async history(req: AuthRequest, value: string, query: unknown) {
    requireRole(req, 'ADMIN', 'FINANCE');
    const id = z.string().uuid().parse(value);
    const p = z
      .object({
        before: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      })
      .strict()
      .parse(query);
    const [asset] = await this.db.query('SELECT id FROM assets WHERE id=$1', [id]);
    if (!asset) throw new NotFoundException('Asset not found');
    const values: any[] = [id];
    let boundary = '';
    if (p.before) {
      const [cursor] = await this.db.query(
        'SELECT occurred_at,id FROM asset_finance_events WHERE asset_id=$1 AND id=$2',
        [id, p.before],
      );
      if (!cursor) throw new NotFoundException('Finance history cursor not found for this asset');
      values.push(cursor.id);
      boundary =
        'AND (e.occurred_at,e.id)<(SELECT occurred_at,id FROM asset_finance_events WHERE asset_id=$1 AND id=$2::uuid)';
    }
    values.push(p.limit + 1);
    const rows = await this.db.query(
      `SELECT e.id,e.action,e.reason,e.finance_version,e.details,e.occurred_at,u.display_name AS actor FROM asset_finance_events e JOIN users u ON u.id=e.actor_id WHERE e.asset_id=$1 ${boundary} ORDER BY e.occurred_at DESC,e.id DESC LIMIT $${values.length}`,
      values,
    );
    return {
      items: rows.slice(0, p.limit).map(camel),
      nextCursor: rows.length > p.limit ? rows[p.limit - 1].id : null,
    };
  }
  async submit(req: AuthRequest, value: string, body: unknown) {
    requireRole(req, 'ADMIN');
    const id = z.string().uuid().parse(value),
      data = reasonInput.parse(body);
    await this.db.tx(async (c) => {
      const [asset] = await this.db.query('SELECT * FROM assets WHERE id=$1 FOR UPDATE', [id], c);
      if (!asset) throw new NotFoundException('Asset not found');
      assertVersion(req, asset.version);
      const [current] = await this.db.query(
        'SELECT * FROM asset_finance WHERE asset_id=$1 FOR UPDATE',
        [id],
        c,
      );
      if (current?.state === 'SUBMITTED' && current.asset_version === asset.version)
        throw new ConflictException('This version is already awaiting Finance review');
      const [row] = await this.db.query(
        `INSERT INTO asset_finance(asset_id,state,asset_version,submitted_by,submission_reason) VALUES($1,'SUBMITTED',$2,$3,$4)
        ON CONFLICT(asset_id) DO UPDATE SET state='SUBMITTED',asset_version=excluded.asset_version,submitted_by=excluded.submitted_by,submitted_at=now(),submission_reason=excluded.submission_reason,reviewed_by=NULL,reviewed_at=NULL,review_reason=NULL,version=asset_finance.version+1 RETURNING version`,
        [id, asset.version, req.user.id, data.reason],
        c,
      );
      await this.db.query('UPDATE assets SET finance_pending=true WHERE id=$1', [id], c);
      await this.db.query(
        `INSERT INTO asset_finance_events(asset_id,action,actor_id,reason,finance_version,details) VALUES($1,'SUBMITTED',$2,$3,$4,$5)`,
        [
          id,
          req.user.id,
          data.reason,
          row.version,
          JSON.stringify({ assetVersion: asset.version, amendment: !!current?.approved_at }),
        ],
        c,
      );
      await this.db.audit(c, req.user, 'ASSET_FINANCE', id, 'FINANCE_SUBMITTED', {
        reason: data.reason,
        financeVersion: row.version,
        assetVersion: asset.version,
      });
    });
    return this.detail(req, id);
  }
  async review(req: AuthRequest, value: string, body: unknown) {
    requireRole(req, 'FINANCE');
    const id = z.string().uuid().parse(value),
      data = reviewInput.parse(body);
    await this.db.tx(async (c) => {
      const [asset] = await this.db.query('SELECT * FROM assets WHERE id=$1 FOR UPDATE', [id], c);
      if (!asset) throw new NotFoundException('Asset not found');
      const [current] = await this.db.query(
        'SELECT * FROM asset_finance WHERE asset_id=$1 FOR UPDATE',
        [id],
        c,
      );
      if (!current || current.state !== 'SUBMITTED')
        throw new ConflictException('Asset must be submitted before Finance review');
      assertVersion(req, current.version);
      if (current.submitted_by === req.user.id)
        throw new ForbiddenException('A different Finance reviewer must review your submission');
      if (current.asset_version !== asset.version)
        throw new ConflictException(
          'Asset changed after submission. Ask the registrar to resubmit the current version.',
        );
      const action = data.decision === 'APPROVE' ? 'APPROVED' : 'RETURNED';
      let details: any = { assetVersion: asset.version };
      if (data.decision === 'APPROVE') {
        const changes = assetPatch.parse({
          reason: data.reason,
          purchaseCost: data.purchaseCost,
          purchaseDate: data.purchaseDate,
          invoiceNumber: data.invoiceNumber,
          supplier: data.supplier,
        });
        const merged = { ...camel(asset), ...changes };
        await validateAsset(this.db, merged, c, camel(asset));
        await this.db.query(
          `UPDATE assets SET purchase_cost=$2,purchase_date=$3,invoice_number=$4,supplier=$5,finance_pending=false,version=version+1,updated_at=now() WHERE id=$1`,
          [id, data.purchaseCost, data.purchaseDate, data.invoiceNumber, data.supplier],
          c,
        );
        await this.db.query(
          `UPDATE asset_finance SET approved_cost=$2,approved_purchase_date=$3,approved_invoice_number=$4,approved_supplier=$5,approved_at=now(),approved_by=$6,asset_version=$7 WHERE asset_id=$1`,
          [
            id,
            data.purchaseCost,
            data.purchaseDate,
            data.invoiceNumber,
            data.supplier,
            req.user.id,
            asset.version + 1,
          ],
          c,
        );
        details = {
          ...details,
          purchaseCost: data.purchaseCost,
          purchaseDate: data.purchaseDate,
          invoiceNumber: data.invoiceNumber,
          supplier: data.supplier,
          currency: 'INR',
          priorApprovedCost: current.approved_cost,
        };
      }
      const [row] = await this.db.query(
        'UPDATE asset_finance SET state=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4,version=version+1 WHERE asset_id=$1 RETURNING version',
        [id, action, req.user.id, data.reason],
        c,
      );
      await this.db.query(
        'INSERT INTO asset_finance_events(asset_id,action,actor_id,reason,finance_version,details) VALUES($1,$2,$3,$4,$5,$6)',
        [id, action, req.user.id, data.reason, row.version, JSON.stringify(details)],
        c,
      );
      await this.db.audit(c, req.user, 'ASSET_FINANCE', id, `FINANCE_${action}`, {
        reason: data.reason,
        financeVersion: row.version,
        ...details,
      });
    });
    return this.detail(req, id);
  }
  async executive(req: AuthRequest) {
    requireRole(req, 'ADMIN', 'FINANCE', 'EXECUTIVE');
    return this.db.tx(async (c) => {
      await this.db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', [], c);
      const [row] = await this.db
        .query(`SELECT now() AS as_of,count(*)::int AS total_assets,count(*) FILTER(WHERE a.status='Assigned')::int AS assigned_assets,
      count(*) FILTER(WHERE f.state='SUBMITTED')::int AS pending_reviews,count(*) FILTER(WHERE f.state='RETURNED')::int AS returned_reviews,
      count(*) FILTER(WHERE f.asset_id IS NULL)::int AS unsubmitted_assets,count(*) FILTER(WHERE f.approved_at IS NOT NULL)::int AS approved_assets,
      coalesce(sum(f.approved_cost) FILTER(WHERE f.approved_at IS NOT NULL),0)::text AS approved_acquisition_cost,
      count(*) FILTER(WHERE a.status IN ('Lost','Stolen'))::int AS missing_assets,
      count(*) FILTER(WHERE a.warranty_expiry BETWEEN current_date AND current_date+30)::int AS warranty_expiring
      FROM assets a LEFT JOIN asset_finance f ON f.asset_id=a.id`);
      const [tickets] = await this.db.query(
        `SELECT count(*) FILTER(WHERE status<>'COMPLETED')::int AS open_tickets,count(*) FILTER(WHERE status<>'COMPLETED' AND priority='HIGH')::int AS high_priority_open FROM tickets`,
      );
      const departments = await this.db.query(
        `SELECT coalesce(d.name,'Not set') AS department,count(*)::int AS asset_count,count(*) FILTER(WHERE f.approved_at IS NOT NULL)::int AS approved_count,coalesce(sum(f.approved_cost) FILTER(WHERE f.approved_at IS NOT NULL),0)::text AS approved_cost FROM assets a LEFT JOIN departments d ON d.id=a.department_id LEFT JOIN asset_finance f ON f.asset_id=a.id GROUP BY d.name ORDER BY count(*) DESC,coalesce(d.name,'Not set') LIMIT 25`,
      );
      return {
        ...camel(row),
        ...camel(tickets),
        departments: departments.map(camel),
        currency: 'INR',
        definitions: {
          approvedAcquisitionCost:
            'Sum of latest Finance-approved INR acquisition costs, including the last approved value while an amendment is pending. Not net book value, depreciation, cash spend or budget variance.',
          approvedAssets:
            'Assets with at least one Finance approval; pending amendments retain the last approved snapshot.',
          scope:
            'Organization-wide, all asset statuses. Department breakdown shows the largest 25 groups. No employee identities or private ticket text.',
        },
      };
    });
  }
}
@Controller('finance')
@UseGuards(SessionGuard)
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly service: FinanceService) {}
  @Get('queue') queue(@Req() req: AuthRequest, @Query() q: unknown) {
    return this.service.queue(req, q);
  }
  @Get('executive-summary') executive(@Req() req: AuthRequest) {
    return this.service.executive(req);
  }
  @Get('assets/:id') detail(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.service.detail(req, id);
  }
  @Get('assets/:id/history') history(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.history(req, id, q);
  }
  @Post('assets/:id/submit') submit(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.submit(req, id, body);
  }
  @Post('assets/:id/review') review(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.review(req, id, body);
  }
}
