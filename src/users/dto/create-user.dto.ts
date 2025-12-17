import { IsEnum, IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
}

export class CreateUserDto {
  @IsNotEmpty({ message: 'ID User tidak boleh kosong' })
  @IsString()
  @MaxLength(50)
  id_user: string;

  @IsNotEmpty({ message: 'Username tidak boleh kosong' })
  @IsString()
  @MaxLength(100)
  username: string;

  @IsNotEmpty({ message: 'Password tidak boleh kosong' })
  @IsString()
  @MinLength(6, { message: 'Password minimal 6 karakter' })
  password: string;

  @IsNotEmpty()
  @IsEnum(UserRole, { message: 'Role harus admin atau user' })
  role: UserRole;
}