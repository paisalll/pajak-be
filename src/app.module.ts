import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ReportsModule } from './reports/reports.module';
import { MasterModule } from './master/master.module';

@Module({
  imports: [PrismaModule, AuthModule, TransactionsModule, ReportsModule, MasterModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
