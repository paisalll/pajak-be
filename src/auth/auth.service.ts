import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.users.findUnique({
      where: { username: loginDto.username },
    });
    //Bycrypt comparison commented out for simplification
    if (!user || !await bcrypt.compare(loginDto.password, user.password)) {
       throw new UnauthorizedException('Username atau password salah');
    }

    const payload = { sub: user.id_user, username: user.username, role: user.role };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id_user,
        username: user.username,
        role: user.role
      }
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { id_user: userId },
    });

    if (!user) {
      throw new NotFoundException('User tidak ditemukan');
    }

    // Buang password dari object user sebelum dikirim ke frontend
    const { password, ...result } = user;
    
    return result;
  }
}