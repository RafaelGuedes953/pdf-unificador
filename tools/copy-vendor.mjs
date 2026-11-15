// Copia para vendor/ só o que o navegador precisa do pdf.js e do SortableJS.
// Assim essas bibliotecas (e as dependências opcionais pesadas do pdfjs-dist,
// que só servem para rodar no Node) ficam fora da imagem de produção.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const target = join(root, 'vendor');

const copies = [
  // [origem dentro de node_modules, destino dentro de vendor]
  ['pdfjs-dist/build/pdf.min.mjs', 'pdfjs/build/pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/build/pdf.worker.min.mjs'],
  ['pdfjs-dist/cmaps', 'pdfjs/cmaps'],
  ['pdfjs-dist/standard_fonts', 'pdfjs/standard_fonts'],
  ['pdfjs-dist/wasm', 'pdfjs/wasm'],
  ['pdfjs-dist/iccs', 'pdfjs/iccs'],
  ['pdfjs-dist/LICENSE', 'pdfjs/LICENSE'],
  ['sortablejs/Sortable.min.js', 'sortable/Sortable.min.js'],
  ['sortablejs/LICENSE', 'sortable/LICENSE'],
];

rmSync(target, { recursive: true, force: true });
for (const [from, to] of copies) {
  const source = join(modules, from);
  if (!existsSync(source)) {
    console.error(`copy-vendor: não encontrei ${from}. Rode "npm ci" antes.`);
    process.exit(1);
  }
  const destination = join(target, to);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
}
console.log(`copy-vendor: ${copies.length} itens copiados para vendor/`);
