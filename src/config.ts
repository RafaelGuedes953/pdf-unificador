export interface Config {
  host: string;
  port: number;
  /** Máximo de arquivos por job. */
  maxFiles: number;
  /** Tamanho máximo de cada arquivo, em bytes. */
  maxFileBytes: number;
  /** Tamanho máximo somado dos arquivos de um job, em bytes. */
  maxTotalBytes: number;
  /** Máximo de páginas no PDF final. */
  maxPages: number;
  /** Máximo de pixels de uma imagem de entrada. */
  maxImagePixels: number;
  /** Jobs de unificação simultâneos. Acima disso o servidor responde 429. */
  maxConcurrentJobs: number;
  /** Threads usadas pelo sharp/libvips. */
  sharpConcurrency: number;
}

const MB = 1024 * 1024;

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Variável ${name} inválida: "${raw}" (esperado inteiro maior que zero)`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: positiveInt(env, 'PORT', 3000),
    maxFiles: positiveInt(env, 'MAX_FILES', 20),
    maxFileBytes: positiveInt(env, 'MAX_FILE_MB', 25) * MB,
    maxTotalBytes: positiveInt(env, 'MAX_TOTAL_MB', 100) * MB,
    maxPages: positiveInt(env, 'MAX_PAGES', 300),
    maxImagePixels: positiveInt(env, 'MAX_IMAGE_MEGAPIXELS', 100) * 1_000_000,
    maxConcurrentJobs: positiveInt(env, 'MAX_CONCURRENT_JOBS', 2),
    sharpConcurrency: positiveInt(env, 'SHARP_CONCURRENCY', 2),
  };
}
