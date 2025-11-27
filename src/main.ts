import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Enable Validation
  app.useGlobalPipes(new ValidationPipe());

  // 2. Enable CORS
  app.enableCors({
    origin: 'http://localhost:8035', // Sesuaikan port Frontend
    credentials: true,
  });

  await app.listen(3000);
}
bootstrap();