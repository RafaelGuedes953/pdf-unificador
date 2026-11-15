import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../src/errors.js';
import { fitWithinA4, mergeToPdf } from '../src/merge.js';
import { parsePlan, type PlanItem } from '../src/plan.js';
import { makeGif, makeJpeg, makePdf, makePng, makeWebp, pageInfo } from './helpers.js';

const opts = { maxImagePixels: 100_000_000 };

async function rejectsWith(promise: Promise<unknown>, status: number): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof AppError, `esperava AppError, veio ${String(error)}`);
    assert.equal(error.status, status);
    return error;
  }
  assert.fail('esperava um erro, mas a operação terminou');
}

describe('mergeToPdf', () => {
  it('une PDFs e imagens respeitando a ordem do plano', async () => {
    const a = await makePdf([
      [300, 400],
      [310, 410],
    ]);
    const b = await makePdf([[200, 200]]);
    const photo = await makeJpeg(800, 400);

    const plan: PlanItem[] = [
      { file: 2, page: null, rotation: 0 }, // imagem
      { file: 1, page: 0, rotation: 0 }, // b, página 1
      { file: 0, page: 1, rotation: 0 }, // a, página 2
      { file: 0, page: 0, rotation: 0 }, // a, página 1
    ];
    const out = await mergeToPdf(
      [
        { name: 'a.pdf', data: a },
        { name: 'b.pdf', data: b },
        { name: 'foto.jpg', data: photo },
      ],
      plan,
      opts,
    );

    const pages = await pageInfo(out);
    assert.equal(pages.length, 4);
    assert.deepEqual(
      pages.slice(1).map((p) => [p.width, p.height]),
      [
        [200, 200],
        [310, 410],
        [300, 400],
      ],
    );
    // A imagem (paisagem 2:1) é ajustada ao A4 paisagem, mantendo a proporção.
    const first = pages[0]!;
    assert.ok(Math.abs(first.width / first.height - 2) < 0.01);
    assert.ok(first.width <= 842);
  });

  it('soma a rotação pedida à rotação que a página já tinha', async () => {
    const pdf = await makePdf(
      [
        [300, 400],
        [300, 400],
      ],
      { rotations: [90, 0] },
    );
    const out = await mergeToPdf(
      [{ name: 'r.pdf', data: pdf }],
      [
        { file: 0, page: 0, rotation: 90 },
        { file: 0, page: 1, rotation: 270 },
      ],
      opts,
    );
    const pages = await pageInfo(out);
    assert.equal(pages[0]!.rotation, 180);
    assert.equal(pages[1]!.rotation, 270);
  });

  it('aplica a orientação EXIF das fotos (retrato gravado como paisagem)', async () => {
    // Pixels 400x200 com orientação 6: a foto deve aparecer em pé (200x400).
    const photo = await makeJpeg(400, 200, 6);
    const out = await mergeToPdf([{ name: 'celular.jpg', data: photo }], [{ file: 0, page: null, rotation: 0 }], opts);
    const [page] = await pageInfo(out);
    assert.ok(page!.height > page!.width, `esperava retrato, veio ${page!.width}x${page!.height}`);
    assert.ok(Math.abs(page!.height / page!.width - 2) < 0.01);
  });

  it('aceita buffers que são fatias de um buffer maior (arquivos pequenos vindos do upload)', async () => {
    // Regressão: o pdf-lib ignorava o deslocamento da fatia e falhava com "SOI not found in JPEG".
    const slice = async (data: Buffer): Promise<Buffer> =>
      Buffer.concat([Buffer.alloc(7, 0xff), data]).subarray(7);
    const jpegSlice = await slice(await makeJpeg(60, 30));
    const pngSlice = await slice(await makePng(40, 40));
    assert.notEqual(jpegSlice.byteOffset, 0);

    const out = await mergeToPdf(
      [
        { name: 'pequena.jpg', data: jpegSlice },
        { name: 'pequena.png', data: pngSlice },
      ],
      [
        { file: 0, page: null, rotation: 0 },
        { file: 1, page: null, rotation: 0 },
      ],
      opts,
    );
    assert.equal((await pageInfo(out)).length, 2);
  });

  it('aceita PNG com transparência e WebP', async () => {
    const png = await makePng(120, 80);
    const webp = await makeWebp(80, 120);
    const out = await mergeToPdf(
      [
        { name: 'a.png', data: png },
        { name: 'b.webp', data: webp },
      ],
      [
        { file: 0, page: null, rotation: 0 },
        { file: 1, page: null, rotation: 0 },
      ],
      opts,
    );
    assert.equal((await pageInfo(out)).length, 2);
  });

  it('rejeita formato de imagem não suportado', async () => {
    const gif = await makeGif(20, 20);
    const error = await rejectsWith(
      mergeToPdf([{ name: 'anim.gif', data: gif }], [{ file: 0, page: null, rotation: 0 }], opts),
      415,
    );
    assert.match(error.message, /anim\.gif/);
  });

  it('rejeita arquivo que não é PDF nem imagem', async () => {
    const error = await rejectsWith(
      mergeToPdf([{ name: 'texto.txt', data: Buffer.from('isto nao e um arquivo valido') }], [{ file: 0, page: null, rotation: 0 }], opts),
      422,
    );
    assert.match(error.message, /texto\.txt/);
  });

  it('rejeita PDF corrompido', async () => {
    await rejectsWith(
      mergeToPdf([{ name: 'quebrado.pdf', data: Buffer.from('%PDF-1.7 lixo') }], [{ file: 0, page: 0, rotation: 0 }], opts),
      422,
    );
  });

  it('rejeita página inexistente no PDF', async () => {
    const pdf = await makePdf([[100, 100]]);
    const error = await rejectsWith(
      mergeToPdf([{ name: 'um.pdf', data: pdf }], [{ file: 0, page: 4, rotation: 0 }], opts),
      400,
    );
    assert.match(error.message, /página 5/);
  });

  it('rejeita imagem acima do limite de pixels', async () => {
    const photo = await makeJpeg(400, 400);
    await rejectsWith(
      mergeToPdf([{ name: 'grande.jpg', data: photo }], [{ file: 0, page: null, rotation: 0 }], { maxImagePixels: 1000 }),
      422,
    );
  });
});

describe('fitWithinA4', () => {
  it('mantém a proporção e cabe no A4', () => {
    const portrait = fitWithinA4(1000, 2000);
    assert.ok(portrait.height <= 841.9 && portrait.width <= 595.3);
    assert.ok(Math.abs(portrait.height / portrait.width - 2) < 1e-9);

    const landscape = fitWithinA4(3000, 1000);
    assert.ok(landscape.width <= 841.9 && landscape.height <= 595.3);
    assert.ok(Math.abs(landscape.width / landscape.height - 3) < 1e-9);
  });
});

describe('parsePlan', () => {
  const valid = { items: [{ file: 0, page: 0, rotation: 90 }] };

  it('aceita um plano válido', () => {
    assert.deepEqual(parsePlan(valid, 1, 10), [{ file: 0, page: 0, rotation: 90 }]);
  });

  it('trata page ausente como imagem e rotation ausente como zero', () => {
    assert.deepEqual(parsePlan({ items: [{ file: 0 }] }, 1, 10), [{ file: 0, page: null, rotation: 0 }]);
  });

  it('rejeita planos malformados', () => {
    const cases: unknown[] = [
      null,
      {},
      { items: [] },
      { items: [{ file: 3, page: 0 }] }, // arquivo inexistente
      { items: [{ file: -1, page: 0 }] },
      { items: [{ file: 0, page: -1 }] },
      { items: [{ file: 0, page: 1.5 }] },
      { items: [{ file: 0, page: 0, rotation: 45 }] },
      { items: [{ file: 0, page: 0, rotation: '90' }] },
      {
        items: [
          { file: 0, page: 0 },
          { file: 0, page: 0 },
        ],
      }, // página repetida
    ];
    for (const input of cases) {
      assert.throws(() => parsePlan(input, 1, 10), AppError, JSON.stringify(input));
    }
  });

  it('respeita o máximo de páginas', () => {
    const items = Array.from({ length: 3 }, (_, page) => ({ file: 0, page }));
    assert.throws(() => parsePlan({ items }, 1, 2), (error: unknown) => error instanceof AppError && error.status === 413);
  });
});
