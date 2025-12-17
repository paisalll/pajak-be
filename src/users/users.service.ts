import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private excludePassword(user: any) {
    const { password, ...result } = user;
    return result;
  }
  async create(dto: CreateUserDto) {
    // 1. Cek apakah username sudah ada
    // (HAPUS pengecekan id_user karena ID digenerate otomatis)
    const existingUser = await this.prisma.users.findUnique({ // Ubah findFirst jadi findUnique agar lebih cepat
      where: { 
        username: dto.username 
      },
    });

    if (existingUser) {
      throw new ConflictException('Username sudah digunakan');
    }

    // 2. Hash Password
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    // 3. Simpan
    // Prisma akan otomatis mengisi id_user dengan UUID karena @default(uuid()) di schema
    const newUser = await this.prisma.users.create({
      data: {
        ...dto, 
        password: hashedPassword,
      } as Prisma.usersCreateInput,
    });

    return this.excludePassword(newUser);
  }

  async findAll() {
    const users = await this.prisma.users.findMany();
    return users.map((user) => this.excludePassword(user));
  }

  async findOne(id: string) {
    const user = await this.prisma.users.findUnique({
      where: { id_user: id },
    });

    if (!user) throw new NotFoundException(`User dengan ID ${id} tidak ditemukan`);

    return this.excludePassword(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);

    const dataToUpdate: any = { ...dto };

    if (dto.password) {
      const salt = await bcrypt.genSalt();
      dataToUpdate.password = await bcrypt.hash(dto.password, salt);
    }

    const updatedUser = await this.prisma.users.update({
      where: { id_user: id },
      data: dataToUpdate,
    });

    return this.excludePassword(updatedUser);
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.users.delete({
      where: { id_user: id },
    });
  }
}