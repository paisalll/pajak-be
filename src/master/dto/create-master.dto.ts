import { IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCoaDto {
  @IsNotEmpty({ message: 'Kode Akun (ID COA) tidak boleh kosong' })
  @IsString()
  @MaxLength(20, { message: 'Kode Akun maksimal 20 karakter' })
  id_coa: string;

  @IsNotEmpty({ message: 'Nama Akun tidak boleh kosong' })
  @IsString()
  @MaxLength(100, { message: 'Nama Akun maksimal 100 karakter' })
  nama_akun: string;
}

export class CreatePartnerDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  id_partner: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  nama_partner: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  npwp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  tipe?: string; // 'Customer' / 'Vendor'
}

export class CreateCompanyDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  id_company: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  nama_perusahaan: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  npwp?: string;

  @IsOptional()
  @IsString()
  alamat?: string;
}

export class CreatePpnDto {
  @IsNotEmpty()
  @IsString()
  label: string; // e.g. "PPN 11%"

  @IsNotEmpty()
  @IsNumber()
  rate: number; // e.g. 0.11

  @IsOptional()
  @IsString()
  id_coa_keluaran?: string;

  @IsOptional()
  @IsString()
  id_coa_masukan?: string;
}

export class CreatePphDto {
  @IsNotEmpty()
  @IsString()
  label: string; // e.g. "PPh 23"

  @IsNotEmpty()
  @IsNumber()
  rate: number; // e.g. 0.02

  @IsOptional()
  @IsString()
  jenis_pph?: string;

  @IsOptional()
  @IsString()
  id_coa_penjualan?: string;

  @IsOptional()
  @IsString()
  id_coa_pembelian?: string;
}