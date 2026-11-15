import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as PDFLib from 'pdf-lib';
import sharp from 'sharp';
import {
  MergeError,
  detectImageFormat,
  fitWithinA4,
  isPdf,
  mergeInBrowser,
  readJpegInfo,
  webpHasAlpha,
} from '../public/merge-client.js';
import { fitWithinA4 as serverFitWithinA4, mergeToPdf } from '../src/merge.js';
import type { PlanItem } from '../src/plan.js';
import { makeGif, makeJpeg, makePdf, makePng, makeWebp, pageInfo } from './helpers.js';

type RasterizeCall = { asPng: boolean };

/**
 * Rasterizador de teste: no navegador quem decodifica e recodifica é o canvas.
 * Aqui o sharp faz o mesmo papel, e `calls` registra quando o caminho de recodificação foi usado.
 */
function fakeRasterizer() {
  const calls: RasterizeCall[] = [];
  const rasterize = async (data: Uint8Array, { asPng }: { asPng: boolean; maxPixels: number }) => {
    calls.push({ asPng });
    const pipeline = sharp(data).rotate();
    const { data: bytes, info } = await (asPng ? pipeline.png() : pipeline.toColourspace('srgb').jpeg({ quality: 90 })).toBuffer({
      resolveWithObject: true,
    });
    return { bytes: new Uint8Array(bytes), width: info.width, height: info.height };
  };
  return { rasterize, calls };
}

async function rejectsWithMergeError(promise: Promise<unknown>, status: number): Promise<MergeError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof MergeError, `esperava MergeError, veio ${String(error)}`);
    assert.equal(error.status, status);
    return error;
  }
  assert.fail('esperava um erro, mas a operação terminou');
}

describe('readJpegInfo', () => {
  it('lê dimensões, componentes e orientação EXIF', async () => {
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const info = readJpegInfo(await makeJpeg(120, 80, orientation));
      assert.deepEqual(info, { width: 120, height: 80, components: 3, orientation }, `orientação ${orientation}`);
    }
  });

  it('considera orientação 1 quando não há EXIF', async () => {
    assert.equal(readJpegInfo(await makeJpeg(50, 40))?.orientation, 1);
  });

  it('identifica JPEG em escala de cinza e CMYK', async () => {
    // "b-w" grava um JPEG de 1 componente (o grayscale() sozinho continua em RGB, com 3).
    const gray = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#888' } })
      .toColourspace('b-w')
      .jpeg()
      .toBuffer();
    const cmyk = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#c00' } })
      .toColourspace('cmyk')
      .jpeg()
      .toBuffer();

    assert.equal(readJpegInfo(gray)?.components, 1);
    assert.equal(readJpegInfo(cmyk)?.components, 4);
    // E confere com o que o sharp enxerga no mesmo arquivo.
    assert.equal((await sharp(gray).metadata()).channels, 1);
    assert.equal((await sharp(cmyk).metadata()).channels, 4);
  });

  it('devolve null para dados que não são JPEG ou estão truncados', async () => {
    assert.equal(readJpegInfo(new Uint8Array([1, 2, 3, 4, 5])), null);
    assert.equal(readJpegInfo(new Uint8Array([0xff, 0xd8])), null);
    assert.equal(readJpegInfo((await makeJpeg(50, 40)).subarray(0, 12)), null);
  });
});

describe('detectImageFormat, isPdf e webpHasAlpha', () => {
  it('reconhece o formato pelos bytes e recusa os demais', async () => {
    assert.equal(detectImageFormat(await makeJpeg(10, 10)), 'jpeg');
    assert.equal(detectImageFormat(await makePng(10, 10)), 'png');
    assert.equal(detectImageFormat(await makeWebp(10, 10)), 'webp');
    assert.equal(detectImageFormat(await makeGif(10, 10)), null);
    assert.equal(detectImageFormat(new Uint8Array(0)), null);
  });

  it('isPdf aceita o cabeçalho dentro dos primeiros 1024 bytes', async () => {
    assert.equal(isPdf(await makePdf([[100, 100]])), true);
    assert.equal(isPdf(Buffer.concat([Buffer.alloc(500, 0x20), Buffer.from('%PDF-1.7\n')])), true);
    assert.equal(isPdf(await makeJpeg(10, 10)), false);
  });

  it('webpHasAlpha distingue WebP com e sem transparência', async () => {
    const opaque = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0a0' } }).webp().toBuffer();
    const opaqueLossless = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0a0' } })
      .webp({ lossless: true })
      .toBuffer();
    const translucent = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 160, b: 0, alpha: 0.5 } },
    })
      .webp()
      .toBuffer();
    const translucentLossless = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 160, b: 0, alpha: 0.5 } },
    })
      .webp({ lossless: true })
      .toBuffer();

    assert.equal(webpHasAlpha(opaque), false);
    assert.equal(webpHasAlpha(opaqueLossless), false);
    assert.equal(webpHasAlpha(translucent), true);
    assert.equal(webpHasAlpha(translucentLossless), true);
  });
});

describe('fitWithinA4 (cliente)', () => {
  it('dá o mesmo resultado que o servidor', () => {
    for (const [w, h] of [
      [800, 400],
      [400, 800],
      [3000, 3000],
      [10, 10],
      [4000, 3000],
    ] as const) {
      assert.deepEqual(fitWithinA4(w, h), serverFitWithinA4(w, h));
    }
  });
});

describe('mergeInBrowser', () => {
  it('escolhe o caminho certo para cada imagem (sem recomprimir JPEG já correto)', async () => {
    const { rasterize, calls } = fakeRasterizer();
    const run = (data: Uint8Array) => mergeInBrowser([{ name: 'x', data }], [{ file: 0, page: null, rotation: 0 }], { PDFLib, rasterize });

    await run(await makeJpeg(100, 60)); // orientação 1: vai direto
    assert.equal(calls.length, 0);

    await run(await makeJpeg(100, 60, 6)); // precisa de correção EXIF
    await run(await makePng(100, 60)); // PNG
    await run(await makeWebp(100, 60)); // WebP sem alfa
    assert.deepEqual(calls, [{ asPng: false }, { asPng: true }, { asPng: false }]);

    const translucent = await sharp({
      create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } },
    })
      .webp()
      .toBuffer();
    await run(translucent); // WebP com alfa vira PNG
    assert.deepEqual(calls.at(-1), { asPng: true });
  });

  it('gera o mesmo PDF (páginas, tamanhos e rotações) que o servidor', async () => {
    const a = await makePdf(
      [
        [300, 400],
        [310, 410],
      ],
      { rotations: [90, 0] },
    );
    const b = await makePdf([[200, 200]]);
    const files = [
      { name: 'a.pdf', data: a },
      { name: 'b.pdf', data: b },
      { name: 'paisagem.jpg', data: await makeJpeg(800, 400) },
      { name: 'retrato-gravado-como-paisagem.jpg', data: await makeJpeg(600, 300, 6) },
      { name: 'transparente.png', data: await makePng(120, 120) },
      { name: 'web.webp', data: await makeWebp(300, 500) },
    ];
    const plan: PlanItem[] = [
      { file: 3, page: null, rotation: 0 },
      { file: 0, page: 1, rotation: 180 },
      { file: 2, page: null, rotation: 90 },
      { file: 1, page: 0, rotation: 0 },
      { file: 4, page: null, rotation: 270 },
      { file: 0, page: 0, rotation: 90 },
      { file: 5, page: null, rotation: 0 },
    ];

    const { rasterize } = fakeRasterizer();
    const local = await mergeInBrowser(files, plan, { PDFLib, rasterize });
    const server = await mergeToPdf(files, plan, { maxImagePixels: 100_000_000 });

    assert.deepEqual(await pageInfo(local), await pageInfo(server));
  });

  it('usa só os arquivos citados no plano e aceita buffers que são fatias de um buffer maior', async () => {
    const pdf = await makePdf([[300, 400]]);
    const padded = Buffer.concat([Buffer.alloc(16), pdf]);
    const slice = padded.subarray(16); // deslocamento diferente de zero
    const photo = (await makeJpeg(50, 50)).subarray(0); // pequeno, como os do upload

    const out = await mergeInBrowser(
      [
        { name: 'a.pdf', data: slice },
        { name: 'nao-usado.jpg', data: new Uint8Array([1, 2, 3]) },
        { name: 'foto.jpg', data: photo },
      ],
      [
        { file: 0, page: 0, rotation: 0 },
        { file: 2, page: null, rotation: 0 },
      ],
      { PDFLib, rasterize: fakeRasterizer().rasterize },
    );
    assert.equal((await pageInfo(out)).length, 2);
  });

  it('rejeita formato de imagem não suportado (415) e arquivo que não é PDF nem imagem', async () => {
    const run = (data: Uint8Array) => mergeInBrowser([{ name: 'x.gif', data }], [{ file: 0, page: null, rotation: 0 }], { PDFLib });
    const error = await rejectsWithMergeError(run(await makeGif(20, 20)), 415);
    assert.match(error.message, /Formato não suportado em "x\.gif"/);
    await rejectsWithMergeError(run(Buffer.from('isto não é um arquivo válido')), 415);
  });

  it('rejeita PDF corrompido e página inexistente', async () => {
    const corrupt = Buffer.from('%PDF-1.7\nlixo que não é um pdf de verdade');
    await rejectsWithMergeError(
      mergeInBrowser([{ name: 'ruim.pdf', data: corrupt }], [{ file: 0, page: 0, rotation: 0 }], { PDFLib }),
      422,
    );

    const pdf = await makePdf([[100, 100]]);
    const error = await rejectsWithMergeError(
      mergeInBrowser([{ name: 'a.pdf', data: pdf }], [{ file: 0, page: 3, rotation: 0 }], { PDFLib }),
      400,
    );
    assert.match(error.message, /tem 1 página\(s\), mas o plano pede a página 4/);
  });

  it('rejeita plano incoerente com o tipo do arquivo', async () => {
    const pdf = await makePdf([[100, 100]]);
    const photo = await makeJpeg(40, 40);
    await rejectsWithMergeError(
      mergeInBrowser([{ name: 'a.pdf', data: pdf }], [{ file: 0, page: null, rotation: 0 }], { PDFLib }),
      400,
    );
    await rejectsWithMergeError(
      mergeInBrowser([{ name: 'f.jpg', data: photo }], [{ file: 0, page: 2, rotation: 0 }], { PDFLib }),
      400,
    );
    await rejectsWithMergeError(
      mergeInBrowser([{ name: 'a.pdf', data: pdf }], [{ file: 5, page: 0, rotation: 0 }], { PDFLib }),
      400,
    );
  });

  it('rejeita imagem acima do limite de pixels', async () => {
    const photo = await makeJpeg(400, 300); // 120 mil pixels
    await rejectsWithMergeError(
      mergeInBrowser([{ name: 'f.jpg', data: photo }], [{ file: 0, page: null, rotation: 0 }], {
        PDFLib,
        maxImagePixels: 1000,
      }),
      422,
    );
    await rejectsWithMergeError(
      mergeInBrowser([{ name: 'f.png', data: await makePng(100, 100) }], [{ file: 0, page: null, rotation: 0 }], {
        PDFLib,
        maxImagePixels: 1000,
      }),
      422,
    );
  });

  it('encapsula falhas do rasterizador como erro 422 com o nome do arquivo', async () => {
    const photo = await makeJpeg(100, 60, 6);
    const error = await rejectsWithMergeError(
      mergeInBrowser([{ name: 'foto.jpg', data: photo }], [{ file: 0, page: null, rotation: 0 }], {
        PDFLib,
        rasterize: async () => {
          throw new Error('canvas quebrou');
        },
      }),
      422,
    );
    assert.match(error.message, /Não foi possível ler a imagem "foto\.jpg"/);
  });
});
