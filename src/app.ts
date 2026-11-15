import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import sharp from 'sharp';
import { loadConfig, type Config } from './config.js';
import { AppError } from './errors.js';
import { mergeToPdf, type InputFile } from './merge.js';
import { parsePlan } from './plan.js';

const MB = 1024 * 1024;

const rootDir = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export interface AppOptions {
  config?: Config;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({ logger: options.logger ?? true });

  // O libvips guarda cache e usa várias threads; num Raspberry isso vira consumo de memória.
  sharp.cache(false);
  sharp.concurrency(config.sharpConcurrency);

  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxFileBytes,
      files: config.maxFiles,
      fields: 4,
      fieldSize: 256 * 1024,
    },
  });

  // Interface web (public/) e bibliotecas do navegador (vendor/, gerada por "npm run vendor"),
  // tudo servido localmente, sem CDN.
  await app.register(fastifyStatic, { root: rootDir('../public'), prefix: '/' });
  await app.register(fastifyStatic, {
    root: rootDir('../vendor'),
    prefix: '/vendor/',
    decorateReply: false,
    maxAge: '1d',
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      // A causa técnica fica só no log; ao usuário vai a mensagem amigável.
      if (error.cause) request.log.warn({ err: error.cause }, error.message);
      return reply.code(error.status).send({ error: error.message });
    }
    const code = (error as FastifyError).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply
        .code(413)
        .send({ error: `Um dos arquivos passa do limite de ${config.maxFileBytes / MB} MB.` });
    }
    if (code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({ error: `Envie no máximo ${config.maxFiles} arquivos por vez.` });
    }
    const status = (error as FastifyError).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'Requisição inválida.' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Erro interno ao gerar o PDF.' });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/config', async () => ({
    maxFiles: config.maxFiles,
    maxFileMb: config.maxFileBytes / MB,
    maxTotalMb: config.maxTotalBytes / MB,
    maxPages: config.maxPages,
  }));

  let activeJobs = 0;

  app.post('/api/merge', async (request, reply) => {
    if (activeJobs >= config.maxConcurrentJobs) {
      reply.header('Retry-After', '5');
      throw new AppError(429, 'O servidor está ocupado com outros PDFs. Tente de novo em instantes.');
    }
    activeJobs += 1;
    try {
      const files: InputFile[] = [];
      let rawPlan: unknown;
      let totalBytes = 0;

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'files') {
            part.file.resume();
            continue;
          }
          const data = await part.toBuffer();
          totalBytes += data.length;
          if (totalBytes > config.maxTotalBytes) {
            throw new AppError(413, `O total dos arquivos passa do limite de ${config.maxTotalBytes / MB} MB.`);
          }
          files.push({ name: part.filename || `arquivo-${files.length + 1}`, data });
        } else if (part.fieldname === 'plan' && typeof part.value === 'string') {
          try {
            rawPlan = JSON.parse(part.value);
          } catch {
            throw new AppError(400, 'O plano enviado não é um JSON válido.');
          }
        }
      }

      if (files.length === 0) throw new AppError(400, 'Nenhum arquivo foi enviado.');
      const plan = parsePlan(rawPlan, files.length, config.maxPages);
      const pdf = await mergeToPdf(files, plan, { maxImagePixels: config.maxImagePixels });

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="unificado.pdf"')
        .header('Cache-Control', 'no-store')
        .send(pdf);
    } finally {
      activeJobs -= 1;
    }
  });

  return app;
}
