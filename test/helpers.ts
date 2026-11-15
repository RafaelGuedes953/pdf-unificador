import { PDFDocument, degrees } from 'pdf-lib';
import sharp from 'sharp';

/** Cria um PDF onde cada página tem um tamanho conhecido, para conferir a ordem depois. */
export async function makePdf(
  sizes: Array<[number, number]>,
  options: { rotations?: number[] } = {},
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  sizes.forEach(([width, height], index) => {
    const page = doc.addPage([width, height]);
    const rotation = options.rotations?.[index];
    if (rotation) page.setRotation(degrees(rotation));
  });
  return Buffer.from(await doc.save());
}

export function makeJpeg(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  }).jpeg();
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
}

export function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 120, b: 200, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
}

export function makeWebp(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 160, b: 80 } },
  })
    .webp()
    .toBuffer();
}

export function makeGif(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 90, g: 90, b: 90 } },
  })
    .gif()
    .toBuffer();
}

/** Tamanho da caixa (largura, altura) e rotação de cada página. A rotação não altera a caixa. */
export async function pageInfo(
  pdf: Uint8Array,
): Promise<Array<{ width: number; height: number; rotation: number }>> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((page) => ({
    width: Math.round(page.getWidth()),
    height: Math.round(page.getHeight()),
    rotation: page.getRotation().angle,
  }));
}
