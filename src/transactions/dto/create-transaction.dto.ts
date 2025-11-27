import { IsString, IsNumber, IsDateString, IsEnum, IsOptional } from 'class-validator';

export class CreateTransactionDto {
  @IsString()
  id_company: string;

  @IsDateString()
  tanggal: string;

  @IsString()
  no_invoice: string;

  @IsEnum(['penjualan', 'pembelian'])
  type: 'penjualan' | 'pembelian';

  @IsString()
  id_partner: string;

  @IsString()
  id_akun_debit: string;

  @IsString()
  id_akun_kredit: string;

  @IsNumber()
  dpp: number;

  @IsNumber()
  @IsOptional()
  id_ppn?: number;

  // field lain opsional...
}