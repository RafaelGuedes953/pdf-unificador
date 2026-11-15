import { PDFDocument, PDFImage, PDFPage, degrees } from 'pdf-lib';
import sharp from 'sharp';
import { AppError } from './errors.js';
import type { PlanItem } from './plan.js';

export interface InputFile {
  name: string;
  data: Buffer;
}

export interface MergeOptions {
  /** Limite de pixels aceito para cada imagem de entrada. */
  maxImagePixels: number;
}

type Kind = 'pdf' | 'image';

interface PreparedImage {
  embed: PDFImage;
  width: number;
  height: number;
}

// Página A4 em pontos (72 por polegada). Imagens são ajustadas dentro dela.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;

const JPEG_QUALITY = 90;

/**
 * Copia os bytes para um Uint8Array próprio (deslocamento zero).
 * O Node entrega buffers pequenos como fatias de um pool compartilhado, e o pdf-lib
 * lê imagens ignorando o deslocamento da fatia, o que quebra arquivos pequenos.
 */
function ownBytes(data: Uint8Array): Uint8Array {
  return Uint8Array.from(data);
}

function isPdf(data: Buffer): boolean {
  // A especificação permite o cabeçalho "%PDF-" em qualquer ponto dos primeiros 1024 bytes.
  return data.subarray(0, 1024).includes('%PDF-');
}

/** Ajusta a imagem dentro de uma página A4 (retrato ou paisagem), sem cortar e sem deformar. */
export function fitWithinA4(width: number, height: number): { width: number; height: number } {
  const landscape = width > height;
  const maxWidth = landscape ? A4_LONG : A4_SHORT;
  const maxHeight = landscape ? A4_SHORT : A4_LONG;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

async function prepareImage(out: PDFDocument, file: InputFile, opts: MergeOptions): Promise<PreparedImage> {
  try {
    const source = sharp(file.data, { limitInputPixels: opts.maxImagePixels });
    const meta = await source.metadata();
    const format = meta.format;
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') {
      throw new AppError(415, `Formato não suportado em "${file.name}". Use JPG, PNG, WebP ou PDF.`);
    }

    const orientation = meta.orientation ?? 1;
    const jpegAsIs =
      format === 'jpeg' && orientation === 1 && (meta.space === 'srgb' || meta.space === 'b-w');

    // JPEG já correto vai direto para o PDF, sem recomprimir.
    if (jpegAsIs && meta.width && meta.height) {
      const embed = await out.embedJpg(ownBytes(file.data));
      return { embed, width: meta.width, height: meta.height };
    }

    // Demais casos passam pelo sharp: aplica a orientação EXIF e normaliza para sRGB.
    const pipeline = sharp(file.data, { limitInputPixels: opts.maxImagePixels }).rotate();
    const asPng = format === 'png' || meta.hasAlpha === true;
    const { data, info } = await (asPng
      ? pipeline.png()
      : pipeline.toColourspace('srgb').jpeg({ quality: JPEG_QUALITY })
    ).toBuffer({ resolveWithObject: true });

    const bytes = ownBytes(data);
    const embed = asPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    return { embed, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, `Não foi possível ler a imagem "${file.name}".`, { cause: error });
  }
}

async function loadPdf(file: InputFile): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(file.data, { ignoreEncryption: false, updateMetadata: false });
    // Um arquivo corrompido pode "carregar" sem erro e só falhar ao contar as páginas.
    if (doc.getPageCount() < 1) throw new Error('PDF sem páginas');
    return doc;
  } catch (error) {
    const encrypted = error instanceof Error && error.name === 'EncryptedPDFError';
    throw new AppError(
      422,
      encrypted
        ? `O arquivo "${file.name}" está protegido por senha e não é suportado.`
        : `Não foi possível ler o PDF "${file.name}".`,
      { cause: error },
    );
  }
}

/** Monta o PDF final seguindo o plano (ordem, rotação) e devolve os bytes. */
export async function mergeToPdf(files: InputFile[], plan: PlanItem[], opts: MergeOptions): Promise<Buffer> {
  const out = await PDFDocument.create({ updateMetadata: false });
  out.setProducer('pdf-unificador');
  out.setCreator('pdf-unificador');
  out.setCreationDate(new Date());

  // 1) Detecta o tipo de cada arquivo usado e valida a compatibilidade com o plano.
  const used = [...new Set(plan.map((item) => item.file))];
  const kinds = new Map<number, Kind>();
  for (const index of used) {
    const file = files[index];
    if (!file) throw new AppError(400, 'O plano referencia um arquivo que não foi enviado.');
    kinds.set(index, isPdf(file.data) ? 'pdf' : 'image');
  }
  for (const item of plan) {
    const kind = kinds.get(item.file);
    const name = files[item.file]?.name ?? 'arquivo';
    if (kind === 'pdf' && item.page === null) {
      throw new AppError(400, `O plano não informa a página do PDF "${name}".`);
    }
    if (kind === 'image' && item.page !== null && item.page !== 0) {
      throw new AppError(400, `A imagem "${name}" tem uma única página.`);
    }
  }

  // 2) Carrega cada fonte uma vez e copia de uma só vez as páginas necessárias de cada PDF.
  //    Copiar tudo numa chamada evita duplicar fontes e recursos compartilhados.
  const copiedPages = new Map<string, PDFPage>();
  const images = new Map<number, PreparedImage>();
  for (const index of used) {
    const file = files[index] as InputFile;
    if (kinds.get(index) === 'pdf') {
      const source = await loadPdf(file);
      const pageCount = source.getPageCount();
      const wanted = plan.filter((item) => item.file === index).map((item) => item.page as number);
      const outOfRange = wanted.find((page) => page >= pageCount);
      if (outOfRange !== undefined) {
        throw new AppError(
          400,
          `O PDF "${file.name}" tem ${pageCount} página(s), mas o plano pede a página ${outOfRange + 1}.`,
        );
      }
      const copies = await out.copyPages(source, wanted);
      wanted.forEach((page, position) => copiedPages.set(`${index}:${page}`, copies[position] as PDFPage));
    } else {
      images.set(index, await prepareImage(out, file, opts));
    }
  }

  // 3) Monta o documento na ordem do plano.
  for (const item of plan) {
    let page: PDFPage;
    if (kinds.get(item.file) === 'pdf') {
      page = out.addPage(copiedPages.get(`${item.file}:${item.page}`) as PDFPage);
    } else {
      const image = images.get(item.file) as PreparedImage;
      const size = fitWithinA4(image.width, image.height);
      page = out.addPage([size.width, size.height]);
      page.drawImage(image.embed, { x: 0, y: 0, width: size.width, height: size.height });
    }
    if (item.rotation !== 0) {
      page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
    }
  }

  return Buffer.from(await out.save());
}
