/* global Terminal, FitAddon, require, monaco */

const $ = (id) => document.getElementById(id);

// ============================================================
// TERMINAL
// ============================================================

const term = new Terminal({
  fontFamily: 'monospace',
  fontSize: 14,
  cursorBlink: true,
  scrollback: 10000,
  theme: {
    background: '#0c0c0c',
    foreground: '#e8e8e8',
    cursor: '#e8e8e8',
    selectionBackground: '#3a3a3a',
  },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open($('terminal'));

// Nenhum atalho próprio: tudo vai pro bash. As duas únicas exceções são as
// mesmas do Konsole: Ctrl+Shift+C copia e Ctrl+Shift+V cola.
term.attachCustomKeyEventHandler((ev) => {
  if (ev.type !== 'keydown') return true;
  if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyC') {
    const sel = term.getSelection();
    if (sel) window.api.copiar(sel);
    ev.preventDefault();
    return false;
  }
  if (ev.ctrlKey && ev.shiftKey && ev.code === 'KeyV') {
    window.api.colar().then((t) => { if (t) window.api.ptyWrite(t); });
    ev.preventDefault();
    return false;
  }
  return true;
});

term.onData((data) => window.api.ptyWrite(data));
window.api.onPtyData((data) => term.write(data));

async function abrirShell() {
  $('shell-fim').hidden = true;
  fit.fit();
  await window.api.ptySpawn(term.cols, term.rows);
  term.focus();
}

window.api.onPtyExit(() => {
  $('shell-fim').hidden = false;
});

$('btn-reabrir').addEventListener('click', () => {
  term.reset();
  abrirShell();
});

// Encolheu ou cresceu a área (janela, lateral, divisor): reajusta o terminal.
let ajustePendente = null;
new ResizeObserver(() => {
  clearTimeout(ajustePendente);
  ajustePendente = setTimeout(() => {
    fit.fit();
    window.api.ptyResize(term.cols, term.rows);
  }, 50);
}).observe($('terminal'));

// ============================================================
// LATERAL DE PASTAS
// ============================================================

const ICONE_PASTA = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.5 2h5l1.5 2h6.5A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-13A1.5 1.5 0 0 1 0 12.5v-9A1.5 1.5 0 0 1 1.5 2z" opacity=".85"/></svg>';
const ICONE_PASTA_ABERTA = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.5 2h5l1.5 2H14a1 1 0 0 1 1 1v1H3.2a1.5 1.5 0 0 0-1.43 1.05L0 12V3.5A1.5 1.5 0 0 1 1.5 2zm1.7 5h11.6a1 1 0 0 1 .96 1.27l-1.3 4.5a1.5 1.5 0 0 1-1.44 1.08H1.6a1 1 0 0 1-.96-1.28l1.63-4.5A1.5 1.5 0 0 1 3.2 7z"/></svg>';
const ICONE_ARQUIVO = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3 0h7l3 3v13H3V0zm6.5 1H4v14h8V4.5H9.5V1z" opacity=".7"/></svg>';

let itemAtivo = null;

function linhaDaArvore(caminho, nome, ehPasta, nivel) {
  const el = document.createElement('div');
  el.className = 'item' + (nome.startsWith('.') ? ' oculto' : '');
  el.style.paddingLeft = 8 + nivel * 14 + 'px';
  el.innerHTML = (ehPasta ? ICONE_PASTA : ICONE_ARQUIVO) + '<span></span>';
  el.querySelector('span').textContent = nome;
  el.title = caminho;
  return el;
}

async function montarPasta(dir, recipiente, nivel) {
  let itens;
  try {
    itens = await window.api.listDir(dir);
  } catch {
    return; // sem permissão de ler: deixa quieto
  }
  for (const { name, isDir } of itens) {
    const caminho = dir.replace(/\/$/, '') + '/' + name;
    const linha = linhaDaArvore(caminho, name, isDir, nivel);
    recipiente.appendChild(linha);

    if (isDir) {
      const filhos = document.createElement('div');
      filhos.className = 'filhos';
      recipiente.appendChild(filhos);
      let carregada = false;
      linha.addEventListener('click', async () => {
        const abrindo = !filhos.classList.contains('expandida');
        filhos.classList.toggle('expandida', abrindo);
        linha.firstElementChild.outerHTML = abrindo ? ICONE_PASTA_ABERTA : ICONE_PASTA;
        if (abrindo && !carregada) {
          carregada = true;
          await montarPasta(caminho, filhos, nivel + 1);
        }
      });
    } else {
      linha.addEventListener('click', () => {
        abrirArquivo(caminho);
        if (itemAtivo) itemAtivo.classList.remove('aberto-no-editor');
        itemAtivo = linha;
        linha.classList.add('aberto-no-editor');
      });
    }
  }
}

$('btn-lateral').addEventListener('click', () => {
  $('lateral').classList.toggle('fechada');
});

// ============================================================
// EDITOR
// ============================================================

require.config({ paths: { vs: 'node_modules/monaco-editor/min/vs' } });

let editor = null;
let arquivoAberto = null;
let versaoSalva = 0;

function monacoPronto() {
  return new Promise((resolve) => require(['vs/editor/editor.main'], resolve));
}

function atualizarEstado() {
  const sujo = editor && editor.getModel()
    && editor.getModel().getAlternativeVersionId() !== versaoSalva;
  $('modificado').hidden = !sujo;
  $('btn-salvar').disabled = !sujo;
}

function avisar(texto) {
  const el = $('nome-arquivo');
  const antes = el.textContent;
  el.textContent = texto;
  setTimeout(() => { el.textContent = antes; }, 3000);
}

async function abrirArquivo(caminho) {
  const r = await window.api.readFile(caminho).catch(() => ({ erro: 'leitura' }));
  if (r.erro) {
    avisar(
      r.erro === 'binario' ? 'esse arquivo não é texto' :
      r.erro === 'grande' ? 'arquivo grande demais pro editor' :
      'não consegui ler esse arquivo'
    );
    return;
  }

  await monacoPronto();

  if (!editor) {
    editor = monaco.editor.create($('editor'), {
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 14,
      minimap: { enabled: false },
    });
    // Ctrl+S salva — atalho padrão de editor, só vale com o editor em foco.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, salvar);
    editor.onDidChangeModelContent(atualizarEstado);
    $('vazio').classList.add('escondido');
  }

  const modeloVelho = editor.getModel();
  const modelo = monaco.editor.createModel(r.conteudo, undefined, monaco.Uri.file(caminho));
  editor.setModel(modelo);
  if (modeloVelho) modeloVelho.dispose();

  arquivoAberto = caminho;
  versaoSalva = modelo.getAlternativeVersionId();
  $('nome-arquivo').textContent = caminho;
  atualizarEstado();
  editor.focus();
}

async function salvar() {
  if (!editor || !arquivoAberto) return;
  try {
    await window.api.writeFile(arquivoAberto, editor.getValue());
    versaoSalva = editor.getModel().getAlternativeVersionId();
    atualizarEstado();
  } catch {
    avisar('não consegui salvar (permissão?)');
  }
}

$('btn-salvar').addEventListener('click', salvar);

// ============================================================
// DIVISOR entre editor e terminal
// ============================================================

$('divisor').addEventListener('mousedown', (evInicio) => {
  evInicio.preventDefault();
  const area = $('terminal-area');
  const alturaInicio = area.getBoundingClientRect().height;
  const yInicio = evInicio.clientY;

  function mover(ev) {
    const nova = alturaInicio + (yInicio - ev.clientY);
    area.style.height = Math.max(90, nova) + 'px';
  }
  function soltar() {
    window.removeEventListener('mousemove', mover);
    window.removeEventListener('mouseup', soltar);
  }
  window.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', soltar);
});

// ============================================================
// PARTIDA
// ============================================================

(async () => {
  const casa = await window.api.home();
  $('raiz-nome').textContent = casa;
  await montarPasta(casa, $('arvore'), 0);
  await abrirShell();
})();
