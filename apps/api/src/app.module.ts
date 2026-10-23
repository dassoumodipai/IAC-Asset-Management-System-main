import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Db } from './db';
import { AuthController, AuthService } from './auth';
import { SessionGuard } from './security';
import { DomainController, DomainService } from './domain';
import { AssetPhotoController, AssetPhotoService } from './asset-photos';
import { DataTransferController, DataTransferService } from './data-transfers';
@Module({
  controllers: [AuthController, DomainController, AssetPhotoController, DataTransferController],
  providers: [Db, AuthService, SessionGuard, DomainService, AssetPhotoService, DataTransferService],
})
export class AppModule {}
