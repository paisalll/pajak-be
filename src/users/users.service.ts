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
    const existingUser = await this.prisma.users.findFirst({
      where: {
        OR: [{ username: dto.username }, { id_user: dto.id_user }],
      },
    });

    if (existingUser) {
      throw new ConflictException('Username atau ID User sudah digunakan');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const newUser = await this.prisma.users.create({
      data: {
        ...dto,
        password: hashedPassword,
      },
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