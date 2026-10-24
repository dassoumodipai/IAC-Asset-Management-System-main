import { Controller, Get, Inject, Injectable, Param, Req, UseGuards } from '@nestjs/common';
import { Db } from './db';
import { NON_REPORTABLE_STATUSES, assetScope, found, parse, text } from './domain-helpers';
import { AuthRequest, SessionGuard } from './security';

const codeInput = text(40);

@Injectable()
export class ScanService {
  constructor(@Inject(Db) private readonly db: Db) {}

  async view(req: AuthRequest, assetCode: string) {
    const values: any[] = [parse(codeInput, assetCode)];
    const scope = assetScope(req.user, values);
    const row = found(
      (
        await this.db.query(
          `SELECT a.id,a.asset_code,a.category,a.asset_type,a.manufacturer,a.model,a.status,
                  d.name AS department,l.code AS location_code,l.site,l.floor,l.room,
                  EXISTS(SELECT 1 FROM asset_photos p WHERE p.asset_id=a.id) AS has_photo,
                  (${scope}) AS can_view_full
           FROM assets a
           LEFT JOIN departments d ON d.id=a.department_id
           LEFT JOIN locations l ON l.id=a.location_id
           WHERE lower(a.asset_code)=lower(btrim($1))`,
          values,
        )
      )[0],
    );
    return {
      id: row.id as string,
      assetCode: row.asset_code as string,
      category: row.category as string,
      assetType: row.asset_type as string,
      manufacturer: (row.manufacturer ?? null) as string | null,
      model: (row.model ?? null) as string | null,
      department: (row.department ?? null) as string | null,
      location: row.location_code
        ? {
            site: (row.site ?? row.location_code) as string,
            floor: (row.floor ?? null) as string | null,
            room: (row.room ?? null) as string | null,
          }
        : null,
      status: row.status as string,
      hasPhoto: row.has_photo as boolean,
      reportable: !(NON_REPORTABLE_STATUSES as readonly string[]).includes(row.status),
      canViewFull: row.can_view_full as boolean,
    };
  }

  async photo(req: AuthRequest, assetCode: string) {
    const asset = await this.view(req, assetCode);
    const [photo] = await this.db.query('SELECT content FROM asset_photos WHERE asset_id=$1', [
      asset.id,
    ]);
    return {
      dataUrl: photo ? `data:image/jpeg;base64,${photo.content.toString('base64')}` : null,
    };
  }
}

@Controller('scan/:assetCode')
@UseGuards(SessionGuard)
export class ScanController {
  constructor(@Inject(ScanService) private readonly service: ScanService) {}

  @Get()
  view(@Req() req: AuthRequest, @Param('assetCode') assetCode: string) {
    return this.service.view(req, assetCode);
  }

  @Get('photo')
  photo(@Req() req: AuthRequest, @Param('assetCode') assetCode: string) {
    return this.service.photo(req, assetCode);
  }
}
