import { IsString, IsNumber, IsDateString, IsEnum, IsOptional, IsArray, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

// 1. Buat DTO Khusus untuk Item Produk
class ProductItemDto {
  @IsString()
  nama_produk: string;

  @IsString()
  @IsOptional()
  deskripsi?: string;

  @IsNumber()
  qty: number;

  @IsNumber()
  harga_satuan: number; // Harga per item sebelum pajak
}

// 2. DTO Utama
export class CreateTransactionDto {
  @IsString()
  @IsOptional()
  id_company?: string;

  @IsString()
  @IsOptional()
  nama_proyek?: string;

  @IsString()
  @IsOptional()
  pengaju?: string;

  @IsString()
  @IsOptional()
  nama_sales?: string;

  @IsNumber()
  @IsOptional()
  due_date?: number;
  @IsNumber()
  @IsOptional()
  @IsIn([0, 1]) // Validasi hanya boleh angka 0 atau 1
  status_pembayaran?: number;
  
  @IsDateString()
  tanggal_pencatatan: string;

  @IsDateString()
  tanggal_invoice: string;

  @IsDateString()
  tanggal_jatuh_tempo: string;

  @IsString()
  no_invoice: string;

  @IsString()
  no_faktur: string;

  @IsEnum(['penjualan', 'pembelian'])
  type: 'penjualan' | 'pembelian';

  @IsString()
  @IsOptional()
  id_partner?: string;

  @IsString()
  id_akun_debit: string;

  @IsString()
  id_akun_kredit: string;

  // --- FIELD ITEM DIHAPUS (qty, dpp, sub_total) ---
  // Diganti dengan Array Products di bawah ini:

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductItemDto)
  products: ProductItemDto[];

  @IsNumber()
  @IsOptional()
  id_ppn_fk?: number;

  @IsNumber()
  @IsOptional()
  id_pph_fk?: number;
}