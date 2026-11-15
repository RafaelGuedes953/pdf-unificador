import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { makeJpeg, makePdf, pageInfo } from './helpers.js';

const config = {
  ...loadConfig({}),
  maxFiles: 3,
  maxFileBytes: 200 * 1024,
  maxTotalBytes: 300 * 1024,
  maxPages: 5,
};

interface Upload {
  name: string;
  data: Buffer;
  type: string;
}

/** Monta um corpo multipart usando as APIs nativas do Node (FormData + Response). */
async function multipart(uploads: Upload[], plan?: unknown) {
  const form = new FormData();
  for (const upload of uploads) {
    form.append('files', new Blob([new Uint8Array(upload.data)], { type: upload.type }), upload.name);
  }
  if (plan !== undefined) form.append('plan', typeof plan === 'string' ? plan : JSON.stringify(plan));
  const response = new Response(form);
  return {
    headers: { 'content-type': response.headers.get('content-type') as string },
    payload: Buffer.from(await response.arrayBuffer()),
  };
}

describe('API', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildApp({ config, logger: false });
  });
  after(async () => {
    await app.close();
  });

  it('GET /health responde ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok' });
  });

  it('GET /api/config expõe os limites para a interface', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.maxFiles, 3);
    assert.equal(body.maxPages, 5);
    assert.ok(body.maxFileMb > 0 && body.maxTotalMb > 0);
  });

  it('GET / serve a interface e as bibliotecas locais', async () => {
    const index = await app.inject({ method: 'GET', url: '/' });
    assert.equal(index.statusCode, 200);
    assert.match(index.headers['content-type'] as string, /text\/html/);

    const pdfjs = await app.inject({ method: 'GET', url: '/vendor/pdfjs/build/pdf.min.mjs' });
    assert.equal(pdfjs.statusCode, 200);
    assert.match(pdfjs.headers['content-type'] as string, /javascript/);

    const worker = await app.inject({ method: 'GET', url: '/vendor/pdfjs/build/pdf.worker.min.mjs' });
    assert.equal(worker.statusCode, 200);

    const sortable = await app.inject({ method: 'GET', url: '/vendor/sortable/Sortable.min.js' });
    assert.equal(sortable.statusCode, 200);
  });

  it('POST /api/merge devolve um PDF com as páginas na ordem pedida', async () => {
    const pdf = await makePdf([
      [300, 400],
      [320, 420],
    ]);
    const photo = await makeJpeg(600, 300);
    const body = await multipart(
      [
        { name: 'a.pdf', data: pdf, type: 'application/pdf' },
        { name: 'b.jpg', data: photo, type: 'image/jpeg' },
      ],
      {
        items: [
          { file: 1, page: null, rotation: 0 },
          { file: 0, page: 1, rotation: 90 },
        ],
      },
    );
    const res = await app.inject({ method: 'POST', url: '/api/merge', ...body });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'] as string, /unificado\.pdf/);

    const pages = await pageInfo(res.rawPayload);
    assert.equal(pages.length, 2);
    assert.equal(pages[1]!.rotation, 90);
    // No PDF a rotação é um atributo da página; a caixa continua 320x420 e o visualizador a exibe girada.
    assert.equal(pages[1]!.width, 320);
    assert.equal(pages[1]!.height, 420);
  });

  it('rejeita requisição sem arquivos', async () => {
    const body = await multipart([], { items: [{ file: 0, page: 0 }] });
    const res = await app.inject({ method: 'POST', url: '/api/merge', ...body });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /Nenhum arquivo/);
  });

  it('rejeita plano ausente ou inválido', async () => {
    const pdf = await makePdf([[100, 100]]);
    const upload = { name: 'a.pdf', data: pdf, type: 'application/pdf' };

    const semPlano = await app.inject({ method: 'POST', url: '/api/merge', ...(await multipart([upload])) });
    assert.equal(semPlano.statusCode, 400);

    const jsonRuim = await app.inject({ method: 'POST', url: '/api/merge', ...(await multipart([upload], '{nao-e-json')) });
    assert.equal(jsonRuim.statusCode, 400);
    assert.match(jsonRuim.json().error, /JSON/);

    const arquivoInexistente = await app.inject({
      method: 'POST',
      url: '/api/merge',
      ...(await multipart([upload], { items: [{ file: 7, page: 0 }] })),
    });
    assert.equal(arquivoInexistente.statusCode, 400);
  });

  it('rejeita arquivo acima do limite por arquivo', async () => {
    const big = Buffer.alloc(config.maxFileBytes + 1024, 1);
    const body = await multipart([{ name: 'grande.pdf', data: big, type: 'application/pdf' }], {
      items: [{ file: 0, page: 0 }],
    });
    const res = await app.inject({ method: 'POST', url: '/api/merge', ...body });
    assert.equal(res.statusCode, 413);
    assert.match(res.json().error, /limite/);
  });

  it('rejeita mais arquivos que o limite', async () => {
    const pdf = await makePdf([[100, 100]]);
    const uploads = Array.from({ length: config.maxFiles + 1 }, (_, i) => ({
      name: `${i}.pdf`,
      data: pdf,
      type: 'application/pdf',
    }));
    const body = await multipart(uploads, { items: [{ file: 0, page: 0 }] });
    const res = await app.inject({ method: 'POST', url: '/api/merge', ...body });
    assert.equal(res.statusCode, 413);
    assert.match(res.json().error, /no máximo 3 arquivos/);
  });

  it('rejeita quando a soma dos arquivos passa do limite total', async () => {
    const chunk = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(150 * 1024, 1)]);
    const uploads = [1, 2, 3].map((i) => ({ name: `${i}.pdf`, data: chunk, type: 'application/pdf' }));
    const body = await multipart(uploads, { items: [{ file: 0, page: 0 }] });
    const res = await app.inject({ method: 'POST', url: '/api/merge', ...body });
    assert.equal(res.statusCode, 413);
    assert.match(res.json().error, /total/);
  });

  it('rejeita requisição que não é multipart', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/merge', payload: { a: 1 } });
    assert.equal(res.statusCode, 406);
  });
});
