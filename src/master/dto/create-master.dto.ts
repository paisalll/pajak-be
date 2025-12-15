import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

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