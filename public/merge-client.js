// Montagem do PDF no navegador, usada no modo sem servidor (por exemplo, no GitHub Pages).
// Espelha src/merge.ts: mesma ordem do plano, mesma rotação e mesmo ajuste ao A4.
// A biblioteca pdf-lib e o rasterizador de imagens entram por parâmetro, o que permite
// testar quase tudo no Node; só o rasterizador padrão depende de APIs do navegador.

/** Erro com mensagem pronta para o usuário (o mesmo papel do AppError no servidor). */
export class MergeError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {ErrorOptions} [options]
   */
  constructor(message, status = 400, options) {
    super(message, options);
    this.name = 'MergeError';
    this.status = status;
  }
}

// Página A4 em pontos (72 por polegada). Imagens são ajustadas dentro dela.
const A4_SHORT = 595.28;
const A4_LONG = 841.89;

const JPEG_QUALITY = 0.9;
const DEFAULT_MAX_IMAGE_PIXELS = 100_000_000;

/**
 * Teto de pixels para recodificar uma imagem no canvas. Alguns navegadores de celular
 * (Safari no iPhone, principalmente) falham com canvas maiores. 16 MP ainda dá mais de
 * 300 dpi numa página A4, então a redução não é perceptível no papel.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

/** Ajusta a imagem dentro de uma página A4 (retrato ou paisagem), sem cortar e sem deformar. */
export function fitWithinA4(width, height) {
  const landscape = width > height;
  const maxWidth = landscape ? A4_LONG : A4_SHORT;
  const maxHeight = landscape ? A4_SHORT : A4_LONG;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return { width: width * scale, height: height * scale };
}

/**
 * A especificação permite o cabeçalho "%PDF-" em qualquer ponto dos primeiros 1024 bytes.
 * @param {Uint8Array} data
 */
export function isPdf(data) {
  return new TextDecoder('latin1').decode(data.subarray(0, 1024)).includes('%PDF-');
}

/**
 * Detecta o formato pelos primeiros bytes (a extensão do arquivo não é confiável).
 * @param {Uint8Array} data
 * @returns {'jpeg' | 'png' | 'webp' | null}
 */
export function detectImageFormat(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length >= 8 && png.every((byte, index) => data[index] === byte)) return 'png';
  const ascii = (start, text) => [...text].every((char, index) => data[start + index] === char.charCodeAt(0));
  if (data.length >= 12 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';
  return null;
}

/**
 * Lê as dimensões, o número de componentes de cor e a orientação EXIF de um JPEG,
 * sem decodificar a imagem. Devolve null se o arquivo não tiver a estrutura esperada.
 * @param {Uint8Array} data
 * @returns {{ width: number, height: number, components: number, orientation: number } | null}
 */
export function readJpegInfo(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  const u16 = (offset) => (data[offset] << 8) | data[offset + 1];

  let orientation = 1;
  let width = 0;
  let height = 0;
  let components = 0;
  let pos = 2;

  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) {
      pos += 1;
      continue;
    }
    const marker = data[pos + 1];
    if (marker === 0xff) {
      pos += 1; // byte de preenchimento
      continue;
    }
    pos += 2;
    // Marcadores sem tamanho: SOI, TEM e RST0-RST7.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break; // EOI

    const length = u16(pos);
    if (length < 2) break;
    const end = pos + length;

    if (marker === 0xe1) orientation = readExifOrientation(data, pos + 2, end) ?? orientation;

    // SOF0 a SOF15, exceto DHT (c4), JPG (c8) e DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = u16(pos + 3);
      width = u16(pos + 5);
      components = data[pos + 7] ?? 0;
    }
    if (marker === 0xda) break; // SOS: depois dele só há dados da imagem
    pos = end;
  }

  return width > 0 && height > 0 ? { width, height, components, orientation } : null;
}

/** Lê a tag de orientação (0x0112) do segmento APP1 "Exif". Devolve null se não houver. */
function readExifOrientation(data, start, end) {
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  if (end - start < 14 || !exif.every((byte, index) => data[start + index] === byte)) return null;

  const tiff = start + 6;
  const little = data[tiff] === 0x49 && data[tiff + 1] === 0x49; // "II"
  const big = data[tiff] === 0x4d && data[tiff + 1] === 0x4d; // "MM"
  if (!little && !big) return null;

  const u16 = (o) => (little ? data[o] | (data[o + 1] << 8) : (data[o] << 8) | data[o + 1]);
  const u32 = (o) =>
    (little
      ? data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)
      : (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;

  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;

  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * Diz se um WebP tem canal alfa (transparência), olhando só o cabeçalho.
 * @param {Uint8Array} data
 */
export function webpHasAlpha(data) {
  if (data.length < 25) return false;
  const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunk === 'VP8X') return (data[20] & 0x10) !== 0;
  if (chunk === 'VP8L') {
    const header = (data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24)) >>> 0;
    return ((header >>> 28) & 1) === 1;
  }
  return false; // "VP8 " (com perdas) não tem alfa
}

/** Dimensões de um PNG pelo cabeçalho IHDR, ou null. */
function pngSize(data) {
  if (data.length < 24) return null;
  const u32 = (o) => ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

/**
 * Rasteriza no navegador: decodifica (aplicando a orientação EXIF), reduz se passar do teto
 * do canvas e recodifica como JPEG (com fundo branco) ou como PNG (preserva a transparência).
 * @param {Uint8Array} data
 * @param {{ asPng: boolean, maxPixels: number }} options
 * @returns {Promise<{ bytes: Uint8Array, width: number, height: number }>}
 */
export async function rasterizeInBrowser(data, { asPng, maxPixels }) {
  const bitmap = await createImageBitmap(new Blob([data]), { imageOrientation: 'from-image' });
  try {
    const total = bitmap.width * bitmap.height;
    if (total > maxPixels) throw new Error('imagem acima do limite de pixels');

    const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / total));
    const width = Math.max(1, Math.floor(bitmap.width * scale));
    const height = Math.max(1, Math.floor(bitmap.height * scale));

    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas indisponível');
    if (!asPng) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const type = asPng ? 'image/png' : 'image/jpeg';
    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type, quality: JPEG_QUALITY })
      : await new Promise((resolve, reject) =>
          canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob falhou'))), type, JPEG_QUALITY),
        );
    canvas.width = 0; // libera a memória do canvas o quanto antes
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}

/**
 * Prepara uma imagem para entrar no PDF. JPEG que já está na orientação certa e em escala
 * de cinza ou RGB vai direto, sem recomprimir; os demais casos passam pelo rasterizador.
 */
async function decodeImage(file, { maxImagePixels, rasterize }) {
  const format = detectImageFormat(file.data);
  if (!format) {
    throw new MergeError(`Formato não suportado em "${file.name}". Use JPG, PNG, WebP ou PDF.`, 415);
  }

  try {
    if (format === 'jpeg') {
      const info = readJpegInfo(file.data);
      if (info && info.orientation === 1 && (info.components === 3 || info.components === 1)) {
        if (info.width * info.height > maxImagePixels) throw new Error('imagem acima do limite de pixels');
        return { kind: 'jpg', bytes: file.data, width: info.width, height: info.height };
      }
    } else if (format === 'png') {
      const size = pngSize(file.data);
      if (size && size.width * size.height > maxImagePixels) throw new Error('imagem acima do limite de pixels');
    }

    const asPng = format === 'png' || (format === 'webp' && webpHasAlpha(file.data));
    const out = await rasterize(file.data, { asPng, maxPixels: maxImagePixels });
    return { kind: asPng ? 'png' : 'jpg', ...out };
  } catch (error) {
    if (error instanceof MergeError) throw error;
    throw new MergeError(`Não foi possível ler a imagem "${file.name}".`, 422, { cause: error });
  }
}

async function loadPdf(PDFDocument, file) {
  try {
    const doc = await PDFDocument.load(file.data, { ignoreEncryption: false, updateMetadata: false });
    // Um arquivo corrompido pode "carregar" sem erro e só falhar ao contar as páginas.
    if (doc.getPageCount() < 1) throw new Error('PDF sem páginas');
    return doc;
  } catch (error) {
    const encrypted = error instanceof Error && error.name === 'EncryptedPDFError';
    throw new MergeError(
      encrypted
        ? `O arquivo "${file.name}" está protegido por senha e não é suportado.`
        : `Não foi possível ler o PDF "${file.name}".`,
      422,
      { cause: error },
    );
  }
}

/**
 * O pdf-lib lê imagens ignorando o deslocamento de fatias de um buffer maior,
 * então garante um Uint8Array próprio (deslocamento zero).
 */
function ownBytes(data) {
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : Uint8Array.from(data);
}

const yieldToUi = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Monta o PDF final seguindo o plano (ordem, rotação) e devolve os bytes.
 *
 * @param {{ name: string, data: Uint8Array }[]} files arquivos, na ordem que o plano referencia
 * @param {{ file: number, page: number | null, rotation: number }[]} plan uma entrada por página final
 * @param {object} options
 * @param {any} options.PDFLib módulo do pdf-lib (PDFDocument e degrees)
 * @param {number} [options.maxImagePixels] limite de pixels de cada imagem de entrada
 * @param {typeof rasterizeInBrowser} [options.rasterize] decodifica e recodifica imagens
 * @returns {Promise<Uint8Array>}
 */
export async function mergeInBrowser(files, plan, options) {
  const { PDFLib, maxImagePixels = DEFAULT_MAX_IMAGE_PIXELS, rasterize = rasterizeInBrowser } = options;
  const { PDFDocument, degrees } = PDFLib;

  const out = await PDFDocument.create({ updateMetadata: false });
  out.setProducer('pdf-unificador');
  out.setCreator('pdf-unificador');
  out.setCreationDate(new Date());

  // 1) Detecta o tipo de cada arquivo usado e valida a compatibilidade com o plano.
  const used = [...new Set(plan.map((item) => item.file))];
  const kinds = new Map();
  for (const index of used) {
    const file = files[index];
    if (!file) throw new MergeError('O plano referencia um arquivo que não foi enviado.');
    kinds.set(index, isPdf(file.data) ? 'pdf' : 'image');
  }
  for (const item of plan) {
    const kind = kinds.get(item.file);
    const name = files[item.file]?.name ?? 'arquivo';
    if (kind === 'pdf' && item.page === null) {
      throw new MergeError(`O plano não informa a página do PDF "${name}".`);
    }
    if (kind === 'image' && item.page !== null && item.page !== 0) {
      throw new MergeError(`A imagem "${name}" tem uma única página.`);
    }
  }

  // 2) Carrega cada fonte uma vez e copia de uma só vez as páginas necessárias de cada PDF.
  //    Copiar tudo numa chamada evita duplicar fontes e recursos compartilhados.
  const copiedPages = new Map();
  const images = new Map();
  for (const index of used) {
    await yieldToUi(); // deixa a interface atualizar entre um arquivo e outro
    const file = files[index];
    const input = { name: file.name, data: ownBytes(file.data) };

    if (kinds.get(index) === 'pdf') {
      const source = await loadPdf(PDFDocument, input);
      const pageCount = source.getPageCount();
      const wanted = plan.filter((item) => item.file === index).map((item) => item.page);
      const outOfRange = wanted.find((page) => page >= pageCount);
      if (outOfRange !== undefined) {
        throw new MergeError(
          `O PDF "${file.name}" tem ${pageCount} página(s), mas o plano pede a página ${outOfRange + 1}.`,
        );
      }
      const copies = await out.copyPages(source, wanted);
      wanted.forEach((page, position) => copiedPages.set(`${index}:${page}`, copies[position]));
    } else {
      const image = await decodeImage(input, { maxImagePixels, rasterize });
      const bytes = ownBytes(image.bytes);
      const embed = image.kind === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      images.set(index, { embed, width: image.width, height: image.height });
    }
  }

  // 3) Monta o documento na ordem do plano.
  for (const item of plan) {
    let page;
    if (kinds.get(item.file) === 'pdf') {
      page = out.addPage(copiedPages.get(`${item.file}:${item.page}`));
    } else {
      const image = images.get(item.file);
      const size = fitWithinA4(image.width, image.height);
      page = out.addPage([size.width, size.height]);
      page.drawImage(image.embed, { x: 0, y: 0, width: size.width, height: size.height });
    }
    if (item.rotation !== 0) {
      page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360));
    }
  }

  return out.save();
}
