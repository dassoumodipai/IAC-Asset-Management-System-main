import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Db } from './db';
import { AuthController, AuthService } from './auth';
import { SessionGuard } from './security';
import { DomainController, DomainService } from './domain';
import { AssetPhotoController, AssetPhotoService } from './asset-photos';
import { ScanController, ScanService } from './scan';
import { LabelController, LabelService } from './labels';
import { DataTransferController, DataTransferService } from './data-transfers';
import { AdminDashboardController, AdminDashboardService } from './admin-dashboard';
@Module({
  controllers: [
    AuthController,
    DomainController,
    AssetPhotoController,
    ScanController,
    LabelController,
    DataTransferController,
    AdminDashboardController,
  ],
  providers: [
    Db,
    AuthService,
    SessionGuard,
    DomainService,
    AssetPhotoService,
    ScanService,
    LabelService,
    DataTransferService,
    AdminDashboardService,
  ],
})
export class AppModule {}
