import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 1. Enable Validation
  app.useGlobalPipes(new ValidationPipe());

  // 2. Enable CORS (UPDATED)
  app.enableCors({
    origin: [
      'http://localhost:8035',                
      'https://demo-pajak-app.vercel.app',    
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
  });

  await app.listen(3000);
}
bootstrap();