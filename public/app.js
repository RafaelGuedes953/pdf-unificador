import * as pdfjsLib from './vendor/pdfjs/build/pdf.min.mjs';
import { MergeError, mergeInBrowser } from './merge-client.js';

// Caminhos relativos ao app.js: funcionam na raiz do container e em subpastas (GitHub Pages).
const PDFJS_BASE = new URL('./vendor/pdfjs/', import.meta.url).href;
const PDFLIB_URL = new URL('./vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}build/pdf.worker.min.mjs`;
const PDF_OPTIONS = {
  cMapUrl: `${PDFJS_BASE}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${PDFJS_BASE}standard_fonts/`,
  wasmUrl: `${PDFJS_BASE}wasm/`,
  iccUrl: `${PDFJS_BASE}iccs/`,
};

const THUMB_SIZE = 260; // maior lado da miniatura, em pixels
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

const els = {
  input: document.getElementById('file-input'),
  grid: document.getElementById('pages'),
  empty: document.getElementById('empty'),
  status: document.getElementById('status'),
  count: document.getElementById('count'),
  limits: document.getElementById('limits'),
  modeNote: document.getElementById('mode-note'),
  generate: document.getElementById('generate'),
  clear: document.getElementById('clear'),
};

let limits = { maxFiles: 20, maxFileMb: 25, maxTotalMb: 100, maxPages: 300 };

/**
 * 'server': o PDF é montado pelo servidor (container). 'browser': não há servidor
 * (por exemplo, no GitHub Pages) e o PDF é montado neste aparelho, sem enviar nada.
 */
let mode = 'server';

let nextId = 1;
/** Arquivos enviados pelo usuário que ainda têm páginas na lista. */
const files = new Map(); // id -> { id, file, kind: 'pdf' | 'image' }
/** Páginas da lista (uma por cartão). */
const items = new Map(); // id -> { id, fileId, page, rotation, base, card, canvas }

let busy = false; // lendo arquivos ou gerando PDF
let resultUrl = null;

// ---------- utilidades ----------

function showStatus(message, kind = 'info', link) {
  els.status.hidden = false;
  els.status.className = `status ${kind}`;
  els.status.textContent = message;
  if (link) {
    els.status.append(' ');
    const a = document.createElement('a');
    a.href = link.href;
    a.textContent = link.text;
    a.target = '_blank';
    a.rel = 'noopener';
    els.status.append(a);
  }
}

function hideStatus() {
  els.status.hidden = true;
  els.status.textContent = '';
}

function mb(bytes) {
  return bytes / (1024 * 1024);
}

function sizeLabel(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mb(bytes).toFixed(1)} MB`;
}

function kindOf(file) {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('image/') && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'image';
  if (IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'image';
  return null;
}

function pagesLabel(n) {
  return n === 1 ? '1 página' : `${n} páginas`;
}

function updateControls() {
  const total = items.size;
  els.count.textContent = pagesLabel(total);
  els.empty.hidden = total > 0;
  els.generate.disabled = busy || total === 0;
  els.clear.disabled = busy || total === 0;
  els.input.disabled = busy;
  document.querySelector('label[for="file-input"]').style.opacity = busy ? '0.6' : '';
  refreshMoveButtons();
}

function orderedCards() {
  return [...els.grid.children];
}

function refreshMoveButtons() {
  const cards = orderedCards();
  cards.forEach((card, index) => {
    card.querySelector('[data-action="left"]').disabled = index === 0;
    card.querySelector('[data-action="right"]').disabled = index === cards.length - 1;
  });
}

// ---------- miniaturas ----------

function scaledCanvas(source, width, height) {
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function drawRotated(item) {
  if (!item.base) return;
  const turn = item.rotation % 180 !== 0;
  const { base, canvas } = item;
  canvas.width = turn ? base.height : base.width;
  canvas.height = turn ? base.width : base.height;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.drawImage(base, -base.width / 2, -base.height / 2);
  ctx.restore();
}

function setBase(item, baseCanvas) {
  item.base = baseCanvas;
  item.card.querySelector('.loading')?.remove();
  drawRotated(item);
}

// ---------- cartões ----------

function createCard(item, name, subtitle) {
  const card = document.createElement('li');
  card.className = 'card';
  card.dataset.id = String(item.id);
  card.innerHTML = `
    <div class="thumb"><span class="loading">Carregando…</span></div>
    <div class="meta"><span class="name"></span><span class="sub"></span></div>
    <div class="tools">
      <button class="tool" type="button" data-action="left" aria-label="Mover para antes">‹</button>
      <button class="tool" type="button" data-action="rotate" aria-label="Girar 90 graus">↻</button>
      <button class="tool remove" type="button" data-action="remove" aria-label="Remover página">✕</button>
      <button class="tool" type="button" data-action="right" aria-label="Mover para depois">›</button>
    </div>`;
  card.querySelector('.name').textContent = name;
  card.querySelector('.name').title = name;
  card.querySelector('.sub').textContent = subtitle;
  item.canvas = document.createElement('canvas');
  card.querySelector('.thumb').prepend(item.canvas);
  item.card = card;
  return card;
}

function addItem(fileId, page, name, subtitle) {
  const item = { id: nextId++, fileId, page, rotation: 0, base: null, card: null, canvas: null };
  items.set(item.id, item);
  els.grid.append(createCard(item, name, subtitle));
  return item;
}

function removeItem(id) {
  const item = items.get(id);
  if (!item) return;
  item.card.remove();
  items.delete(id);
  const stillUsed = [...items.values()].some((other) => other.fileId === item.fileId);
  if (!stillUsed) files.delete(item.fileId);
  updateControls();
}

function clearAll() {
  els.grid.replaceChildren();
  items.clear();
  files.clear();
  hideStatus();
  updateControls();
}

els.grid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.card');
  const item = items.get(Number(card.dataset.id));
  if (!item) return;
  switch (button.dataset.action) {
    case 'rotate':
      item.rotation = (item.rotation + 90) % 360;
      drawRotated(item);
      break;
    case 'remove':
      removeItem(item.id);
      break;
    case 'left':
      card.previousElementSibling?.before(card);
      refreshMoveButtons();
      break;
    case 'right':
      card.nextElementSibling?.after(card);
      refreshMoveButtons();
      break;
  }
});

// Arrastar para reordenar (mouse e toque; no toque é preciso segurar um instante).
if (window.Sortable) {
  window.Sortable.create(els.grid, {
    animation: 150,
    delay: 200,
    delayOnTouchOnly: true,
    touchStartThreshold: 6,
    filter: 'button',
    preventOnFilter: false,
    ghostClass: 'ghost',
    chosenClass: 'chosen',
    onEnd: refreshMoveButtons,
  });
}

// ---------- leitura dos arquivos ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imagem ilegível'));
    };
    img.src = url;
  });
}

async function addImage(entry) {
  const item = addItem(entry.id, null, entry.file.name, 'imagem');
  updateControls();
  try {
    const img = await loadImage(entry.file);
    setBase(item, scaledCanvas(img, img.naturalWidth, img.naturalHeight));
  } catch {
    removeItem(item.id);
    throw new Error(`Não foi possível ler a imagem "${entry.file.name}".`);
  }
}

async function addPdf(entry) {
  let pdf;
  let loadingTask;
  try {
    // O pdf.js transfere o buffer para o worker, então ele recebe uma cópia.
    const data = new Uint8Array(await entry.file.arrayBuffer());
    loadingTask = pdfjsLib.getDocument({ data, ...PDF_OPTIONS });
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask?.destroy();
    if (error?.name === 'PasswordException') {
      throw new Error(`"${entry.file.name}" está protegido por senha e não é suportado.`);
    }
    throw new Error(`Não foi possível ler o PDF "${entry.file.name}".`);
  }

  try {
    if (items.size + pdf.numPages > limits.maxPages) {
      throw new Error(
        `"${entry.file.name}" tem ${pagesLabel(pdf.numPages)} e passaria do limite de ${limits.maxPages} páginas no total.`,
      );
    }
    // Primeiro cria todos os cartões (a lista aparece de imediato), depois gera as miniaturas.
    const created = [];
    for (let page = 1; page <= pdf.numPages; page += 1) {
      created.push(addItem(entry.id, page - 1, entry.file.name, `página ${page} de ${pdf.numPages}`));
    }
    updateControls();

    for (let index = 0; index < created.length; index += 1) {
      const item = created[index];
      if (!items.has(item.id)) continue; // removida enquanto carregava
      try {
        const pdfPage = await pdf.getPage(index + 1);
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(2, THUMB_SIZE / Math.max(base.width, base.height));
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        pdfPage.cleanup();
        if (items.has(item.id)) setBase(item, canvas);
      } catch {
        // A miniatura falhou, mas a página continua válida para a unificação.
        item.card.querySelector('.loading')?.replaceChildren('Sem prévia');
      }
    }
  } finally {
    await loadingTask.destroy(); // libera o documento e o worker do pdf.js
  }
}

function validateBatch(list) {
  const accepted = [];
  const problems = [];
  let usedFiles = files.size;
  let totalMb = [...files.values()].reduce((sum, f) => sum + mb(f.file.size), 0);

  for (const file of list) {
    const kind = kindOf(file);
    if (!kind) {
      problems.push(`"${file.name}": formato não suportado (use PDF, JPG, PNG ou WebP).`);
    } else if (mb(file.size) > limits.maxFileMb) {
      problems.push(`"${file.name}": passa de ${limits.maxFileMb} MB.`);
    } else if (usedFiles + 1 > limits.maxFiles) {
      problems.push(`"${file.name}": limite de ${limits.maxFiles} arquivos atingido.`);
    } else if (totalMb + mb(file.size) > limits.maxTotalMb) {
      problems.push(`"${file.name}": o total passaria de ${limits.maxTotalMb} MB.`);
    } else {
      accepted.push({ file, kind });
      usedFiles += 1;
      totalMb += mb(file.size);
    }
  }
  return { accepted, problems };
}

async function addFiles(list) {
  if (busy || list.length === 0) return;
  busy = true;
  hideStatus();
  updateControls();

  const { accepted, problems } = validateBatch([...list]);
  for (const { file, kind } of accepted) {
    const entry = { id: nextId++, file, kind };
    files.set(entry.id, entry);
    showStatus(`Lendo "${file.name}"…`);
    try {
      await (kind === 'pdf' ? addPdf(entry) : addImage(entry));
    } catch (error) {
      problems.push(error.message);
    }
    if (![...items.values()].some((item) => item.fileId === entry.id)) files.delete(entry.id);
  }

  busy = false;
  updateControls();
  if (problems.length > 0) showStatus(problems.join(' '), 'error');
  else hideStatus();
}

els.input.addEventListener('change', async () => {
  const selected = [...els.input.files];
  els.input.value = ''; // permite escolher o mesmo arquivo de novo
  await addFiles(selected);
});

// Arrastar arquivos do computador para a página.
let dragDepth = 0;
const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (event) => {
  if (!hasFiles(event)) return;
  dragDepth += 1;
  document.body.classList.add('dragging-files');
});
window.addEventListener('dragleave', (event) => {
  if (!hasFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging-files');
});
window.addEventListener('dragover', (event) => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener('drop', async (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging-files');
  await addFiles([...event.dataTransfer.files]);
});

// ---------- geração do PDF ----------

/** Modo servidor: envia os arquivos e o plano e recebe o PDF pronto. */
async function mergeOnServer(list, plan) {
  const form = new FormData();
  for (const file of list) form.append('files', file, file.name);
  form.append('plan', JSON.stringify(plan));

  const response = await fetch('api/merge', { method: 'POST', body: form });
  if (!response.ok) {
    let message = `Falha ao gerar o PDF (erro ${response.status}).`;
    try {
      message = (await response.json()).error || message;
    } catch {
      // resposta sem JSON: mantém a mensagem padrão
    }
    throw new Error(message);
  }
  return response.blob();
}

/** Modo navegador: monta o PDF neste aparelho, sem enviar nada para lugar nenhum. */
async function mergeLocally(list, plan) {
  const PDFLib = await import(PDFLIB_URL);
  const inputs = [];
  for (const file of list) inputs.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  const bytes = await mergeInBrowser(inputs, plan.items, { PDFLib });
  return new Blob([bytes], { type: 'application/pdf' });
}

async function generate() {
  if (busy || items.size === 0) return;
  busy = true;
  updateControls();
  showStatus('Gerando o PDF…');

  try {
    const ordered = orderedCards().map((card) => items.get(Number(card.dataset.id)));

    // Só usa os arquivos que ainda têm páginas, na ordem em que aparecem.
    const fileIndex = new Map();
    const list = [];
    for (const item of ordered) {
      if (fileIndex.has(item.fileId)) continue;
      fileIndex.set(item.fileId, fileIndex.size);
      list.push(files.get(item.fileId).file);
    }
    const plan = {
      items: ordered.map((item) => ({
        file: fileIndex.get(item.fileId),
        page: item.page,
        rotation: item.rotation,
      })),
    };

    const blob = mode === 'browser' ? await mergeLocally(list, plan) : await mergeOnServer(list, plan);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = resultUrl;
    link.download = 'unificado.pdf';
    document.body.append(link);
    link.click();
    link.remove();

    showStatus(`PDF pronto (${pagesLabel(ordered.length)}, ${sizeLabel(blob.size)}).`, 'ok', {
      href: resultUrl,
      text: 'Abrir',
    });
  } catch (error) {
    let message = error.message;
    if (mode === 'server' && error instanceof TypeError) {
      message = 'Não foi possível falar com o servidor. Verifique a conexão.';
    } else if (mode === 'browser' && !(error instanceof MergeError)) {
      // Falha inesperada (em geral, falta de memória do aparelho ou erro ao carregar a biblioteca).
      message = 'Não foi possível gerar o PDF neste aparelho. Tente com menos arquivos ou arquivos menores.';
    }
    showStatus(message, 'error');
  } finally {
    busy = false;
    updateControls();
  }
}

els.generate.addEventListener('click', generate);
els.clear.addEventListener('click', clearAll);

// ---------- início ----------

async function loadLimits() {
  try {
    const response = await fetch('api/config');
    const config = response.ok ? await response.json().catch(() => null) : null;
    if (config && Number.isFinite(config.maxFiles)) limits = { ...limits, ...config };
    else mode = 'browser'; // o endereço respondeu, mas não é o nosso servidor (ex.: GitHub Pages)
  } catch {
    // sem resposta de rede: mantém o modo servidor e os limites padrão
  }
  els.modeNote.hidden = mode !== 'browser';
  els.limits.textContent = `Até ${limits.maxFiles} arquivos, ${limits.maxFileMb} MB cada (${limits.maxTotalMb} MB no total) e ${limits.maxPages} páginas.`;
}

updateControls();
loadLimits();
