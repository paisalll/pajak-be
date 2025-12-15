import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  Query, 
  UseGuards, 
  Request 
} from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto'; // Import DTO
import { AuthGuard } from '@nestjs/passport';

@UseGuards(AuthGuard('jwt'))
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@Body() createTransactionDto: CreateTransactionDto, @Request() req) {
    return this.transactionsService.create(createTransactionDto, req.user.userId);
  }

  @Get()
  findAll(
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('month') month: number,
    @Query('year') year: number,
    @Query('type') type: 'penjualan' | 'pembelian',
    @Query('search') search: string,
  ) {
    return this.transactionsService.findAll(
      Number(page) || 1, 
      Number(limit) || 10,
      Number(month),
      Number(year),
      type,
      search
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    // Note: id is string now because of INV-00001/25 format
    return this.transactionsService.findOne(id);
  }

  // --- UPDATE ENDPOINT ---
  @Patch(':id')
  update(
    @Param('id') id: string, 
    @Body() updateTransactionDto: UpdateTransactionDto,
    @Request() req
  ) {
    return this.transactionsService.update(id, updateTransactionDto, req.user.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.transactionsService.remove(id);
  }
}