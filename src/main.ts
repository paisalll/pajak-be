import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe());

  app.enableCors({
    origin: [
      'http://localhost:5173',                // Frontend Local
      'http://localhost:3000',                // Backend Local (jika perlu)
      'https://demo-pajak-app.vercel.app',    // Domain Vercel Anda
      /\.vercel\.app$/                        // (Optional) Regex untuk mengizinkan semua sub-domain vercel preview
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  // -------------------------

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();