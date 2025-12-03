import { Controller, Get, Post, Body, UseGuards, Request, Query } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt'))
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@Body() createTransactionDto: CreateTransactionDto, @Request() req) {
    // req.user didapat dari JwtStrategy
    return this.transactionsService.create(createTransactionDto, req.user.userId);
  }

  @Get()
  findAll(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('type') type?: 'penjualan' | 'pembelian',
    @Query('search') search?: string,
  ) {
    return this.transactionsService.findAll(
      month ? Number(month) : undefined,
      year ? Number(year) : undefined,
      type,
      search
    );
  }
}