import { AppError } from './errors.js';

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Uma página do PDF final.
 * - file: índice do arquivo na lista enviada
 * - page: índice (base 0) da página quando o arquivo é PDF; null quando é imagem
 * - rotation: rotação extra, em graus, no sentido horário
 */
export interface PlanItem {
  file: number;
  page: number | null;
  rotation: Rotation;
}

const ROTATIONS: readonly number[] = [0, 90, 180, 270];

function bad(message: string): never {
  throw new AppError(400, message);
}

/** Valida o JSON do plano vindo do cliente. Nunca confia no formato recebido. */
export function parsePlan(raw: unknown, fileCount: number, maxPages: number): PlanItem[] {
  const items = (raw as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) {
    bad('O plano está vazio: adicione ao menos uma página.');
  }
  if (items.length > maxPages) {
    throw new AppError(413, `O PDF final pode ter no máximo ${maxPages} páginas.`);
  }

  const seen = new Set<string>();
  return items.map((entry: unknown, position: number): PlanItem => {
    const item = entry as { file?: unknown; page?: unknown; rotation?: unknown };
    const where = `página ${position + 1} do plano`;

    if (!Number.isInteger(item.file) || (item.file as number) < 0 || (item.file as number) >= fileCount) {
      bad(`Arquivo inválido na ${where}.`);
    }
    const page = item.page === null || item.page === undefined ? null : item.page;
    if (page !== null && (!Number.isInteger(page) || (page as number) < 0)) {
      bad(`Número de página inválido na ${where}.`);
    }
    const rotation = item.rotation === undefined ? 0 : item.rotation;
    if (typeof rotation !== 'number' || !ROTATIONS.includes(rotation)) {
      bad(`Rotação inválida na ${where} (use 0, 90, 180 ou 270).`);
    }

    const key = `${item.file}:${page}`;
    if (seen.has(key)) bad(`A ${where} repete uma página já usada.`);
    seen.add(key);

    return { file: item.file as number, page: page as number | null, rotation: rotation as Rotation };
  });
}
