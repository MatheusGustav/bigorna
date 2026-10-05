/* global Terminal, FitAddon, WebglAddon, require, monaco */

const $ = (id) => document.getElementById(id);

// ============================================================
// TERMINAIS EM ABAS (estilo Konsole, grupos por repositório)
// ============================================================

const OPCOES_DO_TERMINAL = {
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: 14,
  cursorBlink: true,
  scrollback: 10000,
  theme: {
    background: '#0a0a0a',
    foreground: '#e6e6e6',
    cursor: '#ffffff',
    selectionBackground: '#3a3a3a',
  },
};

// Cores das etiquetas de grupo. Cada repositório pega a próxima da fila e
// fica com ela; acabando as cores, a fila recomeça. Verde, amarelo e vermelho
// primeiro (ordem do Matheus); daí em diante, o que combinar com o preto.
const CORES_DE_GRUPO = ['#8fd36a', '#e8c84a', '#e05c5c', '#5fd3c3', '#b48cff', '#6aa1e0', '#ff8a3d'];
const corDoRepo = new Map();
function corDoGrupo(repo) {
  if (!corDoRepo.has(repo)) corDoRepo.set(repo, CORES_DE_GRUPO[corDoRepo.size % CORES_DE_GRUPO.length]);
  return corDoRepo.get(repo);
}

const terminais = new Map(); // id → { term, fit, caixa, info, col }
let proximoTerminal = 1;
let terminalAtivo = null;
let abaDoMenu = null; // aba clicada com o botão direito, pra ela ficar marcada
let casa = ''; // pasta pessoal, pro título "~ bash" da aba

const terminalDaVez = () => terminais.get(terminalAtivo) || null;

// ---------- colunas ----------
// A área pode ser dividida em colunas lado a lado, quantas couberem no gosto
// do Matheus. Cada coluna tem a própria barra de abas e mostra um terminal
// por vez; clicar numa aba só troca o terminal daquela coluna.

const colunas = []; // { el, listaEl, terminaisEl, ativo }, na ordem da tela
let colunaAtiva = null; // a coluna do terminal com o teclado
let contadorDeColunas = 0;

// As colunas se arrumam em linhas: no máximo 3 por linha, e menos quando a
// faixa do terminal está estreita (com o arquivo aberto, por exemplo) — aí
// uma coluna vai embaixo da outra em vez de ficarem espremidas lado a lado.
const MAXIMO_POR_LINHA = 3;
const LARGURA_MINIMA_DE_COLUNA = 420; // abaixo disso a coluna não cabe ao lado de outra

const idsDaColuna = (col) => [...terminais].filter(([, t]) => t.col === col).map(([id]) => id);

// Encolheu ou cresceu uma coluna (janela, lateral, divisores): reajusta o
// terminal à mostra nela. Os escondidos se ajustam ao serem ativados.
let ajustePendente = null;
const ajustadorDeColunas = new ResizeObserver(() => {
  clearTimeout(ajustePendente);
  ajustePendente = setTimeout(() => {
    for (const col of colunas) {
      const t = terminais.get(col.ativo);
      if (!t) continue;
      t.fit.fit();
      window.api.ptyResize(col.ativo, t.term.cols, t.term.rows);
    }
  }, 50);
});

// Cria a coluna logo depois da coluna dada (ou no fim da fila).
const criarColuna = (aposDe) => criarColunaEm(aposDe ? colunas.indexOf(aposDe) + 1 : colunas.length);

function criarColunaEm(indice) {
  const col = { ativo: null };
  col.el = document.createElement('div');
  col.el.className = 'coluna';
  const abas = document.createElement('div');
  abas.className = 'abas';
  col.listaEl = document.createElement('div');
  col.listaEl.className = 'abas-lista';
  const mais = document.createElement('button');
  mais.className = 'btn-nova-aba';
  mais.textContent = '+';
  mais.title = 'Abrir outro terminal nesta coluna';
  mais.addEventListener('click', () => criarTerminal(undefined, col));
  abas.append(col.listaEl, mais);

  // Pegar na parte vazia da barra arrasta a coluna inteira; soltar em cima de
  // outra coluna troca as duas de lugar.
  abas.draggable = true;
  abas.addEventListener('dragstart', (ev) => {
    if (ev.target !== abas) return; // é o arrasto de uma aba, não da coluna
    ev.dataTransfer.setData(TIPO_COLUNA, '');
    ev.dataTransfer.effectAllowed = 'move';
    arrastandoColuna = col;
    col.el.classList.add('arrastando');
  });
  abas.addEventListener('dragend', () => limparArrasto());
  col.terminaisEl = document.createElement('div');
  col.terminaisEl.className = 'terminais';
  col.el.append(abas, col.terminaisEl);

  col.id = ++contadorDeColunas;
  colunas.splice(indice, 0, col);
  ajustadorDeColunas.observe(col.terminaisEl);
  arrumarLinhas();
  return col;
}

function removerColuna(col) {
  if (temFliperama(col)) return; // a casa do fliperama fica: ele toma a coluna inteira
  const i = colunas.indexOf(col);
  if (i < 0 || colunas.length < 2) return; // a última fica, mesmo vazia
  colunas.splice(i, 1);
  ajustadorDeColunas.unobserve(col.terminaisEl);
  col.el.remove();
  if (colunaAtiva === col) colunaAtiva = colunas[colunas.length - 1];
  arrumarLinhas();
}

// Quantas colunas cabem lado a lado na largura de agora.
function colunasPorLinha() {
  const largura = $('colunas').getBoundingClientRect().width;
  return Math.max(1, Math.min(MAXIMO_POR_LINHA, Math.floor(largura / LARGURA_MINIMA_DE_COLUNA)));
}

// Põe as colunas em linhas, na ordem da fila, com uma divisa arrastável entre
// vizinhas. Refeito a cada mudança de estrutura e quando a largura muda; se
// nada mudou, não mexe (mexer à toa faria o terminal piscar).
let arranjoAtual = '';
function arrumarLinhas() {
  const porLinha = colunasPorLinha();
  const arranjo = porLinha + ':' + colunas.map((c) => c.id).join(',');
  if (arranjo === arranjoAtual) return;
  arranjoAtual = arranjo;

  const recipiente = $('colunas');
  for (const d of recipiente.querySelectorAll('.divisa-coluna')) d.remove();
  const linhasVelhas = [...recipiente.querySelectorAll('.linha')];

  for (let i = 0; i < colunas.length; i += porLinha) {
    const linha = document.createElement('div');
    linha.className = 'linha';
    recipiente.appendChild(linha);
    for (const col of colunas.slice(i, i + porLinha)) {
      if (col !== colunas[i]) {
        const d = document.createElement('div');
        d.className = 'divisa-coluna';
        d.title = 'Arraste pra mudar a largura';
        d.addEventListener('mousedown', arrastarDivisa);
        linha.appendChild(d);
      }
      // moveBefore muda o lugar sem recriar o canvas: o desenho WebGL
      // sobrevive. Só vale pra quem já está na tela; coluna nova entra do jeito comum.
      if (linha.moveBefore && col.el.isConnected) linha.moveBefore(col.el, null);
      else linha.appendChild(col.el);
    }
  }
  for (const l of linhasVelhas) l.remove();
}

// A largura da faixa mudou (lateral, arquivo, janela): o número de colunas
// por linha pode ter mudado junto.
new ResizeObserver(() => arrumarLinhas()).observe($('colunas'));

// Arrastar a divisa muda a largura das duas colunas vizinhas. O flex-grow de
// cada coluna vira a largura dela em pixels, pra conta fechar.
function arrastarDivisa(evInicio) {
  evInicio.preventDefault();
  const esq = evInicio.currentTarget.previousElementSibling;
  const dir = evInicio.currentTarget.nextElementSibling;
  if (!esq || !dir) return;
  for (const col of colunas) col.el.style.flexGrow = col.el.getBoundingClientRect().width;
  const wEsq = esq.getBoundingClientRect().width;
  const wDir = dir.getBoundingClientRect().width;
  const x0 = evInicio.clientX;
  document.body.classList.add('arrastando-divisa');
  function mover(ev) {
    const delta = Math.max(120 - wEsq, Math.min(ev.clientX - x0, wDir - 120));
    esq.style.flexGrow = wEsq + delta;
    dir.style.flexGrow = wDir - delta;
  }
  function soltar() {
    document.body.classList.remove('arrastando-divisa');
    window.removeEventListener('mousemove', mover);
    window.removeEventListener('mouseup', soltar);
  }
  window.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', soltar);
}

// Leva o terminal pra outra coluna. moveBefore muda o lugar sem recriar o
// canvas, então o desenho WebGL do xterm sobrevive à mudança.
function moverTerminal(id, col) {
  const t = terminais.get(id);
  if (!t || !col || t.col === col) return;
  const origem = t.col;
  t.col = col;
  if (col.terminaisEl.moveBefore) col.terminaisEl.moveBefore(t.caixa, null);
  else col.terminaisEl.appendChild(t.caixa);
  const irmaos = idsDaColuna(origem);
  if (!irmaos.length) {
    origem.ativo = null;
    removerColuna(origem);
  } else if (origem.ativo === id) {
    mostrarNaColuna(irmaos[irmaos.length - 1]);
  }
  ativarTerminal(id);
}

// "Mostrar ao lado": o terminal ganha uma coluna nova, colada na dele.
function mostrarAoLado(id) {
  const t = terminais.get(id);
  if (!t) return;
  moverTerminal(id, criarColuna(t.col));
}

// ---------- arrastar abas ----------
// A aba se arrasta: solta na barra de outra coluna muda de coluna (e de
// posição na fila), solta no meio de um terminal vai pra coluna dele, e solta
// na beirada esquerda ou direita de um terminal vira uma coluna nova ali.

const TIPO_ABA = 'application/x-bigorna-aba';
const TIPO_COLUNA = 'application/x-bigorna-coluna';
let arrastandoAba = null; // id do terminal da aba arrastada
let arrastandoColuna = null; // a coluna arrastada pela parte vazia da barra
let soltarEm = null; // alvo da vez: { col, antesDe } na barra, { col, zona } no terminal, { trocarCom } de coluna

// Muda o terminal de lugar na fila (a ordem do Map é a ordem das abas).
// antesDe null é o fim da fila.
function reordenarTerminal(id, antesDe) {
  if (id === antesDe) return;
  const entradas = [...terminais];
  const de = entradas.findIndex(([outro]) => outro === id);
  if (de < 0) return;
  const [entrada] = entradas.splice(de, 1);
  const para = antesDe == null ? entradas.length : entradas.findIndex(([outro]) => outro === antesDe);
  if (para < 0) return;
  entradas.splice(para, 0, entrada);
  terminais.clear();
  for (const [outro, t] of entradas) terminais.set(outro, t);
}

function limparArrasto() {
  arrastandoAba = null;
  arrastandoColuna = null;
  soltarEm = null;
  $('sombra-de-soltar').hidden = true;
  for (const el of $('colunas').querySelectorAll('.arrastando')) el.classList.remove('arrastando');
}

// Troca duas colunas de lugar. Cada uma leva junto a largura que tinha.
function trocarColunas(a, b) {
  const ia = colunas.indexOf(a);
  const ib = colunas.indexOf(b);
  if (ia < 0 || ib < 0 || a === b) return;
  colunas[ia] = b;
  colunas[ib] = a;
  arrumarLinhas(); // repõe todas na ordem nova
  desenharAbas();
}

// A sombra mostra onde a aba vai cair: linha entre abas ou pedaço do terminal.
function mostrarSombra(x, y, largura, altura) {
  const s = $('sombra-de-soltar');
  s.style.left = x + 'px';
  s.style.top = y + 'px';
  s.style.width = largura + 'px';
  s.style.height = altura + 'px';
  s.hidden = false;
}

$('colunas').addEventListener('dragover', (ev) => {
  const ehColuna = ev.dataTransfer.types.includes(TIPO_COLUNA);
  if (!ehColuna && !ev.dataTransfer.types.includes(TIPO_ABA)) return;
  const colEl = ev.target.closest('.coluna');
  const col = colunas.find((c) => c.el === colEl);
  if (!col) return;

  // coluna arrastada: qualquer ponto de outra coluna é alvo de troca
  if (ehColuna) {
    if (col === arrastandoColuna) {
      soltarEm = null;
      $('sombra-de-soltar').hidden = true;
      return; // em cima de si mesma não há o que trocar
    }
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    soltarEm = { trocarCom: col };
    const r = col.el.getBoundingClientRect();
    mostrarSombra(r.x, r.y, r.width, r.height);
    return;
  }

  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'move';

  const barra = ev.target.closest('.abas');
  if (barra) {
    // na barra: a aba entra antes da aba sob o mouse (metade direita: depois)
    const abas = [...barra.querySelectorAll('.aba')];
    const aba = ev.target.closest('.aba');
    const grupo = ev.target.closest('.grupo');
    let antesDe = null;
    let x;
    if (aba) {
      const r = aba.getBoundingClientRect();
      const depois = ev.clientX > r.x + r.width / 2;
      const vizinha = abas[abas.indexOf(aba) + 1];
      antesDe = depois ? (vizinha ? vizinha.dados.id : null) : aba.dados.id;
      x = depois ? r.right : r.x;
    } else if (grupo) {
      // em cima da etiqueta do grupo: antes da primeira aba dele
      const primeira = grupo.querySelector('.aba');
      antesDe = primeira ? primeira.dados.id : null;
      x = primeira ? primeira.getBoundingClientRect().x : grupo.getBoundingClientRect().right;
    } else {
      const ultima = abas[abas.length - 1];
      x = ultima ? ultima.getBoundingClientRect().right : barra.getBoundingClientRect().x;
    }
    soltarEm = { col, antesDe };
    const rBarra = barra.getBoundingClientRect();
    mostrarSombra(x - 1, rBarra.y, 2, rBarra.height);
    return;
  }

  // no terminal: beirada esquerda ou direita cria coluna, o meio só muda de coluna
  const r = col.terminaisEl.getBoundingClientRect();
  const zona = ev.clientX < r.x + r.width / 4 ? 'esquerda' : ev.clientX > r.right - r.width / 4 ? 'direita' : 'meio';
  soltarEm = { col, zona };
  if (zona === 'meio') mostrarSombra(r.x, r.y, r.width, r.height);
  else if (zona === 'esquerda') mostrarSombra(r.x, r.y, r.width / 2, r.height);
  else mostrarSombra(r.x + r.width / 2, r.y, r.width / 2, r.height);
});

$('colunas').addEventListener('dragleave', (ev) => {
  if (arrastandoAba === null && arrastandoColuna === null) return;
  if (ev.relatedTarget && $('colunas').contains(ev.relatedTarget)) return;
  soltarEm = null;
  $('sombra-de-soltar').hidden = true;
});

$('colunas').addEventListener('drop', (ev) => {
  const ehColuna = ev.dataTransfer.types.includes(TIPO_COLUNA);
  if (!ehColuna && !ev.dataTransfer.types.includes(TIPO_ABA)) return;
  ev.preventDefault();
  ev.stopPropagation();
  const id = Number(ev.dataTransfer.getData(TIPO_ABA));
  const alvo = soltarEm;
  const colArrastada = arrastandoColuna;
  limparArrasto();
  if (!alvo) return;

  if (ehColuna) {
    if (colArrastada && alvo.trocarCom) trocarColunas(colArrastada, alvo.trocarCom);
    return;
  }

  const t = terminais.get(id);
  if (!t) return;

  if (alvo.zona === undefined) {
    // na barra: entra na posição marcada; mudando de coluna, vai junto
    if (alvo.antesDe === id) return;
    reordenarTerminal(id, alvo.antesDe);
    if (t.col === alvo.col) ativarTerminal(id); // já redesenha na ordem nova
    else moverTerminal(id, alvo.col);
    return;
  }
  if (alvo.zona === 'meio') {
    if (t.col === alvo.col) ativarTerminal(id);
    else moverTerminal(id, alvo.col);
    return;
  }
  // beirada: coluna nova no lado escolhido — menos quando a aba está sozinha
  // na própria coluna e cairia no mesmo lugar
  const indice = colunas.indexOf(alvo.col) + (alvo.zona === 'direita' ? 1 : 0);
  const iOrigem = colunas.indexOf(t.col);
  if (idsDaColuna(t.col).length === 1 && (indice === iOrigem || indice === iOrigem + 1)) return;
  moverTerminal(id, criarColunaEm(indice));
}, true); // na captura: passa na frente do soltar de caminho do terminal

async function criarTerminal(pasta, col) {
  $('shell-fim').hidden = true;
  if (!col || !colunas.includes(col)) col = colunaAtiva || colunas[0] || criarColuna();

  const id = proximoTerminal++;
  const caixa = document.createElement('div');
  caixa.className = 'terminal-caixa';
  col.terminaisEl.appendChild(caixa);

  // Clicar num terminal já à mostra passa o teclado (e a coluna da vez) pra
  // ele; o foco em si quem dá é o próprio xterm, pelo mesmo clique.
  caixa.addEventListener('mousedown', () => {
    if (terminalAtivo === id || !terminais.has(id)) return;
    terminalAtivo = id;
    colunaAtiva = terminais.get(id).col;
    desenharAbas();
  });

  const term = new Terminal(OPCOES_DO_TERMINAL);
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(caixa);

  // Desenho pela placa de vídeo, igual ao VS Code. Além de ser mais leve, ele
  // pinta os blocos (█ ▛ ▜) como quadrados cheios; com a letra da fonte ficava
  // um vão entre eles e o bonequinho do Claude saía listrado. Se a placa
  // falhar, o xterm volta sozinho pro desenho comum.
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch (erro) {
    console.warn('[terminal] sem WebGL, usando o desenho comum:', erro);
  }

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
      window.api.colar().then((t) => { if (t) window.api.ptyWrite(id, t); });
      ev.preventDefault();
      return false;
    }
    return true;
  });

  // Entra no mapa antes do bash nascer, senão a primeira letra do prompt
  // poderia chegar sem ter quem a receba.
  terminais.set(id, { term, fit, caixa, info: null, nome: null, col });
  term.onData((data) => window.api.ptyWrite(id, data));

  fit.fit();
  await window.api.ptySpawn(id, term.cols, term.rows, pasta);
  ativarTerminal(id);
  atualizarInfo(id); // batiza a aba sem esperar a próxima rodada do relógio
  return id;
}

// Põe o terminal à mostra na coluna dele, sem mexer no teclado.
function mostrarNaColuna(id) {
  const t = terminais.get(id);
  if (!t) return;
  t.col.ativo = id;
  for (const [outro, o] of terminais) {
    if (o.col === t.col) o.caixa.classList.toggle('escondida', outro !== id);
  }
  // o tamanho pode ter mudado enquanto a aba estava escondida
  requestAnimationFrame(() => {
    t.fit.fit();
    window.api.ptyResize(id, t.term.cols, t.term.rows);
  });
}

function ativarTerminal(id) {
  const t = terminais.get(id);
  if (!t) return;
  terminalAtivo = id;
  colunaAtiva = t.col;
  mostrarNaColuna(id);
  requestAnimationFrame(() => t.term.focus());
  desenharAbas();
}

// jaEncerrou: o bash morreu sozinho (exit); senão é o × da aba matando ele.
function fecharTerminal(id, jaEncerrou) {
  const t = terminais.get(id);
  if (!t) return;
  terminais.delete(id);
  if (!jaEncerrou) window.api.ptyKill(id);
  t.term.dispose();
  t.caixa.remove();
  const irmaos = idsDaColuna(t.col);
  if (!irmaos.length) {
    t.col.ativo = null;
    removerColuna(t.col); // se era a última coluna, ela fica, vazia
  } else if (t.col.ativo === id) {
    mostrarNaColuna(irmaos[irmaos.length - 1]);
  }
  if (terminalAtivo === id) {
    terminalAtivo = null;
    // o teclado vai pro terminal à mostra na mesma coluna, ou na da vez
    const prox = (colunas.includes(t.col) && t.col.ativo) || (colunaAtiva && colunaAtiva.ativo);
    if (prox) return ativarTerminal(prox); // ele já redesenha as abas
  }
  desenharAbas();
  if (!terminais.size && !fliperama) $('shell-fim').hidden = false;
}

window.api.onPtyData((id, data) => {
  const t = terminais.get(id);
  if (t) t.term.write(data);
});
window.api.onPtyExit((id) => fecharTerminal(id, true));

$('btn-reabrir').addEventListener('click', () => criarTerminal());

// ---------- a barra de abas ----------
// De tempo em tempo a Bigorna pergunta de cada terminal: em que pasta está,
// o que roda agora e, se for pasta de repositório git, qual e em que branch.
// Abas do mesmo repositório viram um grupo com etiqueta e linha colorida.

function tituloDaAba(t) {
  const info = t.info;
  if (t.nome) return t.nome;
  if (!info) return '…';
  if (info.branch) return info.branch;
  let pasta = info.cwd || '';
  pasta = pasta === casa ? '~' : pasta.slice(pasta.lastIndexOf('/') + 1);
  return [pasta, info.programa].filter(Boolean).join(' ') || '…';
}

async function atualizarInfo(id) {
  const info = await window.api.ptyInfo(id).catch(() => null);
  const t = terminais.get(id);
  if (!t || !info) return;
  if (JSON.stringify(info) !== JSON.stringify(t.info)) {
    t.info = info;
    desenharAbas();
  }
}

setInterval(() => {
  for (const id of terminais.keys()) atualizarInfo(id);
}, 3000);

function abaDoTerminal(id) {
  const t = terminais.get(id);
  const aba = document.createElement('span');
  aba.className = 'aba' + (id === t.col.ativo ? ' ativa' : '') + (id === abaDoMenu ? ' alvo-do-menu' : '');
  aba.dados = { id };
  if (t.info && t.info.programa === 'claude') {
    const marca = document.createElement('span');
    marca.className = 'claude';
    marca.textContent = '✳';
    marca.title = 'Claude rodando aqui';
    aba.appendChild(marca);
  }
  const titulo = Object.assign(document.createElement('span'), { className: 'titulo', textContent: tituloDaAba(t) });
  aba.appendChild(titulo);
  const x = document.createElement('span');
  x.className = 'x';
  x.textContent = '×';
  x.title = 'Fechar este terminal';
  x.addEventListener('click', (ev) => {
    ev.stopPropagation();
    fecharTerminal(id);
  });
  aba.appendChild(x);
  aba.addEventListener('click', () => ativarTerminal(id));
  aba.draggable = true;
  aba.addEventListener('dragstart', (ev) => {
    if (aba.querySelector('input')) return ev.preventDefault(); // renomeando
    ev.dataTransfer.setData(TIPO_ABA, String(id));
    ev.dataTransfer.effectAllowed = 'move';
    arrastandoAba = id;
    aba.classList.add('arrastando');
  });
  // dispara mesmo soltando fora de qualquer alvo (aí nada muda de lugar)
  aba.addEventListener('dragend', () => {
    limparArrasto();
    desenharAbas();
  });
  return aba;
}

function desenharAbas() {
  // redesenhar com a caixa de renomear aberta apagaria o que está sendo
  // digitado; no meio de um arrasto, sumiria com a aba da mão do mouse
  if ($('colunas').querySelector('.abas input') || arrastandoAba !== null) return;

  for (const col of colunas) {
    col.el.classList.toggle('foco', col === colunaAtiva);
    // o terminal à mostra leva a cor do repositório dele num fio no topo
    const ativo = terminais.get(col.ativo);
    if (ativo && ativo.info && ativo.info.repo) col.el.style.setProperty('--cor', corDoGrupo(ativo.info.repo));
    else col.el.style.removeProperty('--cor'); // sem repositório, a moldura fica no cinza padrão

    const grupos = new Map(); // repositório → abas dele, na ordem de abertura
    const soltas = [];
    for (const [id, t] of terminais) {
      if (t.col !== col) continue;
      if (t.info && t.info.repo) {
        if (!grupos.has(t.info.repo)) grupos.set(t.info.repo, []);
        grupos.get(t.info.repo).push(id);
      } else {
        soltas.push(id);
      }
    }

    const novas = document.createDocumentFragment();
    for (const [repo, ids] of grupos) {
      const grupo = document.createElement('div');
      grupo.className = 'grupo';
      grupo.style.setProperty('--cor', corDoGrupo(repo));
      const etiqueta = document.createElement('span');
      etiqueta.className = 'etiqueta';
      etiqueta.textContent = terminais.get(ids[0]).info.nome;
      etiqueta.title = repo;
      grupo.appendChild(etiqueta);
      for (const id of ids) grupo.appendChild(abaDoTerminal(id));
      novas.appendChild(grupo);
    }
    for (const id of soltas) novas.appendChild(abaDoTerminal(id));
    if (temFliperama(col)) novas.appendChild(abaDoFliperama());
    col.listaEl.replaceChildren(novas);
  }
  arrumarFliperama(); // em pé ou deitado, conforme a coluna dele tenha terminal
  atualizarFora(); // o terminal da vez pode ter mudado de pasta, ou outro virou a vez
}

// ============================================================
// LATERAL DE PASTAS
// ============================================================

// Ícones do Material Icon Theme — o mesmo tema do VS Code, colorido e com um
// desenho por tipo de arquivo e por nome de pasta. Os mapas vêm do processo
// principal uma vez só; sem eles, a linha fica com o espaço do ícone vazio.
let temaDeIcones = null;

function arquivoDoIcone(nome, ehPasta, aberta) {
  const chave = nome.toLowerCase();
  const t = temaDeIcones;
  if (ehPasta) {
    const mapa = aberta ? t.pastaAbertaPorNome : t.pastaPorNome;
    return mapa[chave] || (aberta ? t.padrao.pastaAberta : t.padrao.pasta);
  }
  if (t.porNome[chave]) return t.porNome[chave];
  // Da extensão mais longa pra mais curta: "a.spec.ts" tenta "spec.ts" e depois "ts".
  const partes = chave.split('.');
  for (let i = 1; i < partes.length; i++) {
    const ext = partes.slice(i).join('.');
    if (t.porExtensao[ext]) return t.porExtensao[ext];
  }
  return t.padrao.arquivo;
}

function icone(nome, ehPasta, aberta = false) {
  if (!temaDeIcones) return '<span class="icone"></span>';
  const svg = `${temaDeIcones.pasta}/${arquivoDoIcone(nome, ehPasta, aberta)}`;
  return `<img class="icone" src="${svg}" alt="" draggable="false">`;
}

const TIPO_CAMINHO = 'application/x-bigorna-caminho';

let itemAtivo = null;

// Pastas já lidas do disco: caminho → onde os filhos dela estão na tela.
const pastasLidas = new Map();
// Pastas abertas na lateral, pra continuarem abertas quando a lista é relida.
const pastasAbertas = new Set();

const pastaDe = (caminho) => caminho.slice(0, caminho.lastIndexOf('/'));
const dentroDe = (caminho, pasta) => !!caminho && (caminho === pasta || caminho.startsWith(pasta + '/'));

function linhaDaArvore(caminho, nome, ehPasta, nivel) {
  const el = document.createElement('div');
  el.className = 'item' + (nome.startsWith('.') ? ' oculto' : '');
  el.style.paddingLeft = 8 + nivel * 14 + 'px';
  el.innerHTML = icone(nome, ehPasta) + '<span></span>';
  el.querySelector('span').textContent = nome;
  el.title = caminho;
  el.dados = { caminho, nome, ehPasta, nivel };
  // Arrastar leva o caminho junto, num tipo só da Bigorna: o editor e as caixas
  // de texto não reconhecem esse tipo, então só o terminal aceita.
  el.draggable = true;
  el.addEventListener('dragstart', (ev) => {
    ev.dataTransfer.setData(TIPO_CAMINHO, caminho);
    ev.dataTransfer.effectAllowed = 'copy';
  });
  return el;
}

function marcarAtivo(linha) {
  if (itemAtivo) itemAtivo.classList.remove('aberto-no-editor');
  itemAtivo = linha;
  linha.classList.add('aberto-no-editor');
}

async function montarPasta(dir, recipiente, nivel) {
  let itens;
  try {
    itens = await window.api.listDir(dir);
  } catch {
    return; // sem permissão de ler: deixa quieto
  }
  window.api.vigiarPasta(dir); // mudou algo nela (até por fora), a lista relê
  const novas = document.createDocumentFragment();
  const reabrir = [];
  for (const { name, isDir } of itens) {
    const caminho = dir.replace(/\/$/, '') + '/' + name;
    if (caminho === casa) continue; // a casa já tem a metade de cima; na de baixo ela não entra
    const linha = linhaDaArvore(caminho, name, isDir, nivel);
    novas.appendChild(linha);

    if (isDir) {
      const filhos = document.createElement('div');
      filhos.className = 'filhos';
      novas.appendChild(filhos);
      linha.dados.filhos = filhos;
      linha.addEventListener('click', () => alternarPasta(linha, !filhos.classList.contains('expandida')));
      if (pastasAbertas.has(caminho)) reabrir.push(linha);
    } else {
      if (caminho === arquivoAberto) marcarAtivo(linha);
      linha.addEventListener('click', () => {
        // Jogo não passa pelo editor: liga o fliperama na área dos terminais.
        // Clicar de novo no que está rodando desliga, como nos outros arquivos.
        if (tipoDeMidia(name) === 'jogo') {
          if (fliperama && (jogoAtual === caminho || jogoPedido === caminho)) return fecharFliperama();
          return abrirFliperama(caminho);
        }
        // Clicar no arquivo que já está na tela fecha ele (decisão do Matheus).
        if (caminho === arquivoAberto) return fecharArquivo();
        abrirArquivo(caminho);
        marcarAtivo(linha);
      });
    }
  }
  // Troca tudo de uma vez: relendo uma pasta, a lista não pisca vazia.
  recipiente.replaceChildren(novas);
  for (const linha of reabrir) await alternarPasta(linha, true);
}

async function alternarPasta(linha, abrir) {
  const { caminho, nivel, filhos } = linha.dados;
  filhos.classList.toggle('expandida', abrir);
  linha.firstElementChild.outerHTML = icone(linha.dados.nome, true, abrir);
  if (abrir) pastasAbertas.add(caminho);
  else pastasAbertas.delete(caminho);
  if (abrir && !pastasLidas.has(caminho)) {
    pastasLidas.set(caminho, { recipiente: filhos, nivel: nivel + 1 });
    await montarPasta(caminho, filhos, nivel + 1);
  }
}

// Abre a árvore, pasta por pasta, de `raiz` até `alvo`, e rola até ele aparecer.
async function revelarPasta(alvo, raiz, recipiente) {
  if (!alvo || alvo === raiz || !alvo.startsWith(raiz.replace(/\/$/, '') + '/')) return;
  let linha = null;
  let caminho = raiz.replace(/\/$/, '');
  for (const nome of alvo.slice(caminho.length + 1).split('/')) {
    caminho += '/' + nome;
    linha = [...recipiente.children].find((el) => el.dados?.caminho === caminho);
    if (!linha?.dados.ehPasta) return;
    await alternarPasta(linha, true);
    recipiente = linha.dados.filhos;
  }
  // A janela recém-aberta ainda cresce (maximizar vem depois): até assentar,
  // cada mudança de tamanho centraliza de novo.
  const centrar = () => linha.scrollIntoView({ block: 'center' });
  centrar();
  const vigia = new ResizeObserver(centrar);
  vigia.observe(linha.closest('#arvore, #arvore-fora'));
  setTimeout(() => vigia.disconnect(), 1500);
}

// ---------- metade de baixo: o que está fora da casa ----------
// O terminal da vez saiu da casa (abriram um pendrive, ou foi um cd): a lateral
// se divide e embaixo mostra de onde ele está. Voltou pra casa, ela some.

let pastaPedida = null; // a pasta que outro programa pediu pra abrir, até ser mostrada
let raizFora = null;
let cwdFora = null; // a última pasta de fora conferida, pra não perguntar de novo

function limparFora() {
  for (const c of [...pastasLidas.keys()]) {
    if (dentroDe(c, casa)) continue;
    pastasLidas.delete(c);
    if (c !== pastaVigiadaDoArquivo) window.api.desvigiarPasta(c); // o vigia sai junto da lateral
  }
  $('arvore-fora').replaceChildren();
}

async function atualizarFora() {
  const cwd = terminais.get(terminalAtivo)?.info?.cwd;
  if (!cwd || dentroDe(cwd, casa)) {
    cwdFora = null;
    if (raizFora === null) return;
    raizFora = null;
    $('fora').hidden = true;
    return limparFora();
  }
  if (cwd === cwdFora) return;
  cwdFora = cwd;
  const raiz = await window.api.raizDeFora(cwd).catch(() => cwd);
  if (cwdFora !== cwd || raiz === raizFora) return; // mudou enquanto esperava, ou já está à mostra
  raizFora = raiz;
  limparFora();
  $('fora-nome').textContent = raiz;
  $('fora').hidden = false;
  pastasLidas.set(raiz, { recipiente: $('arvore-fora'), nivel: 0 });
  await montarPasta(raiz, $('arvore-fora'), 0);
  if (dentroDe(pastaPedida, raiz)) await revelarPasta(pastaPedida, raiz, $('arvore-fora'));
  pastaPedida = null;
}

// ---------- arquivo pedido por outro programa (abrir com a Bigorna) ----------
// Desce a lateral até a pasta dele (se ela estiver na casa), abre no editor ou
// no visor e marca a linha, como se tivesse sido clicado.
async function abrirPedido(caminho) {
  if (dentroDe(caminho, casa)) await revelarPasta(pastaDe(caminho), casa, $('arvore'));
  await abrirArquivo(caminho);
  if (caminho !== arquivoAberto) return; // não abriu (erro de leitura): o destaque que estava, fica
  const linha = [...document.querySelectorAll('#lateral .item')].find((el) => el.dados?.caminho === caminho);
  if (linha) marcarAtivo(linha);
  else if (itemAtivo) {
    // o arquivo aberto não tem linha à mostra: nenhuma pode ficar acesa
    itemAtivo.classList.remove('aberto-no-editor');
    itemAtivo = null;
  }
}
window.api.onAbrirArquivo((caminho) => abrirPedido(caminho));

// O vigia avisou que uma pasta mudou (pode ter sido por fora da Bigorna).
window.api.onPastaMudou((dir) => {
  recarregarPasta(dir);
  if (arquivoAberto && pastaDe(arquivoAberto) === dir) recarregarArquivoAberto();
});

// Relê uma pasta do disco depois de criar, renomear, apagar ou compactar.
async function recarregarPasta(dir) {
  const lida = pastasLidas.get(dir);
  if (!lida) return; // ainda não foi aberta: vai ser lida quando abrir
  // Relendo uma pasta da metade de baixo (como /home), o que é da casa fica: é da metade de cima.
  for (const c of pastasLidas.keys()) {
    if (c.startsWith(dir + '/') && (dentroDe(dir, casa) || !dentroDe(c, casa))) {
      pastasLidas.delete(c);
      if (c !== pastaVigiadaDoArquivo) window.api.desvigiarPasta(c); // vai ser vigiada de novo se reaparecer
    }
  }
  // Relendo, a lista encolhe e cresce de novo enquanto reabre as pastas; sem
  // guardar onde estava, ela pularia de lugar.
  const caixa = lida.recipiente.closest('#arvore, #arvore-fora');
  const onde = caixa && caixa.scrollTop;
  await montarPasta(dir, lida.recipiente, lida.nivel);
  if (caixa) caixa.scrollTop = onde;
}

$('btn-lateral').addEventListener('click', () => {
  $('lateral').classList.toggle('fechada');
  atualizarTrilho();
});

// ============================================================
// SOLTAR NO TERMINAL: item da lateral vira o caminho no prompt
// ============================================================

// Igual ao Konsole: caminho só com letra comum vai como está; com espaço,
// acento ou símbolo vai entre aspas simples, senão o bash parte o caminho.
function caminhoProBash(caminho) {
  if (/^[A-Za-z0-9_\/.,+=:@%-]+$/.test(caminho)) return caminho;
  return "'" + caminho.replace(/'/g, "'\\''") + "'";
}

// Soltar arquivo de fora na janela faria ela navegar pro arquivo e a Bigorna
// sumiria. A janela toda recusa o soltar; só o terminal abre exceção abaixo.
window.addEventListener('dragover', (ev) => {
  if (ev.defaultPrevented) return; // o terminal já aceitou
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (ev) => ev.preventDefault());

$('terminal-area').addEventListener('dragover', (ev) => {
  if (!ev.dataTransfer.types.includes(TIPO_CAMINHO)) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = 'copy';
});

// "true": pega o soltar antes da caixa de texto escondida do xterm, que
// escreveria o caminho uma segunda vez.
$('terminal-area').addEventListener('drop', (ev) => {
  const caminho = ev.dataTransfer.getData(TIPO_CAMINHO);
  // o caminho vai pro terminal da coluna onde o mouse soltou
  const colEl = ev.target.closest('.coluna');
  const col = colunas.find((c) => c.el === colEl) || colunaAtiva;
  const t = (col && terminais.get(col.ativo)) || terminalDaVez();
  if (!caminho || !t) return;
  ev.preventDefault();
  ev.stopPropagation();
  // paste e não ptyWrite: se o programa aberto pediu "colagem marcada" (o bash
  // e o Claude Code pedem), ele recebe como colagem e não executa nada sozinho.
  t.term.paste(caminhoProBash(caminho) + ' ');
  t.term.focus();
  if (col && terminalAtivo !== col.ativo) {
    terminalAtivo = col.ativo;
    colunaAtiva = col;
    desenharAbas();
  }
}, true);

// ============================================================
// MENU DO BOTÃO DIREITO na lateral: desenhado aqui, no estilo do
// menu do Dolphin (o do sistema não deixa mudar o tamanho)
// ============================================================

let menuAberto = null; // { raiz, sub }: o menu na tela e o submenu, se tiver
let pedidosDeMenu = 0; // descarta resposta atrasada de um clique antigo

function fecharMenu() {
  pedidosDeMenu++;
  document.querySelectorAll('.alvo-do-menu').forEach((el) => el.classList.remove('alvo-do-menu'));
  abaDoMenu = null;
  if (!menuAberto) return;
  menuAberto.raiz.remove();
  if (menuAberto.sub) menuAberto.sub.remove();
  menuAberto = null;
}

// Põe o menu no ponto (x, y) sem passar da borda da janela. Se não cabe à
// direita, abre pra esquerda a partir de xEsquerda.
function posicionar(menu, x, y, xEsquerda = x) {
  const { width, height } = menu.getBoundingClientRect();
  if (x + width > innerWidth - 4) x = xEsquerda - width;
  if (y + height > innerHeight - 4) y = innerHeight - height - 4;
  menu.style.left = Math.max(4, x) + 'px';
  menu.style.top = Math.max(4, y) + 'px';
}

// itens: { texto, icone, acao } ou { texto, icone, submenu: [...] }; '-' é separador.
function desenharMenu(itens, ehRaiz) {
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.addEventListener('contextmenu', (ev) => ev.preventDefault());
  for (const item of itens) {
    if (item === '-') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-separador' }));
      continue;
    }
    const el = document.createElement('div');
    el.className = 'menu-item' + (item.desligado ? ' desligado' : '');
    const icone = document.createElement(item.icone ? 'img' : 'span');
    icone.className = 'menu-icone';
    if (item.icone) icone.src = item.icone;
    const texto = Object.assign(document.createElement('span'), { className: 'menu-texto', textContent: item.texto });
    el.append(icone, texto);
    if (item.submenu) el.appendChild(Object.assign(document.createElement('span'), { className: 'menu-seta' }));

    // No menu principal, passar o mouse abre o submenu da opção (ou fecha o de outra).
    if (ehRaiz) el.addEventListener('mouseenter', () => abrirSubmenu(item.submenu ? el : null, item.submenu));
    el.addEventListener('click', () => {
      if (item.desligado || item.submenu) return;
      fecharMenu();
      item.acao();
    });
    menu.appendChild(el);
  }
  document.body.appendChild(menu);
  return menu;
}

function abrirSubmenu(itemPai, itens) {
  if (menuAberto.sub) {
    menuAberto.sub.remove();
    menuAberto.sub = null;
    menuAberto.raiz.querySelectorAll('.aberto').forEach((el) => el.classList.remove('aberto'));
  }
  if (!itens) return;
  itemPai.classList.add('aberto');
  menuAberto.sub = desenharMenu(itens, false);
  const r = itemPai.getBoundingClientRect();
  posicionar(menuAberto.sub, r.right + 4, r.top - 5, r.left - 4);
}

function itensDoMenu(linha, opcoes) {
  const { caminho } = linha.dados;
  const ic = opcoes.icones;
  return [
    {
      texto: 'Abrir com',
      icone: ic.abrirCom,
      submenu: opcoes.programas.length
        ? opcoes.programas.map((p) => ({ texto: p.nome, icone: p.icone, acao: () => window.api.abrirCom(p.arquivo, caminho) }))
        : [{ texto: 'nenhum programa encontrado', desligado: true }],
    },
    '-',
    {
      texto: 'Criar novo',
      icone: ic.criarNovo,
      submenu: [
        { texto: 'Pasta…', icone: ic.pasta, acao: () => criarNovo(linha, true) },
        { texto: 'Arquivo vazio…', icone: ic.arquivo, acao: () => criarNovo(linha, false) },
      ],
    },
    '-',
    { texto: 'Renomear…', icone: ic.renomear, acao: () => renomear(linha) },
    { texto: 'Mover pra lixeira', icone: ic.lixeira, acao: () => apagar(linha, 'lixeira') },
    { texto: 'Excluir de vez…', icone: ic.excluir, acao: () => apagar(linha, 'excluir') },
    '-',
    { texto: 'Compactar (.zip)', icone: ic.compactar, acao: () => compactar(linha) },
    opcoes.audio && { texto: 'Transcrever áudio', icone: ic.transcrever, acao: () => window.api.transcrever(caminho) },
    '-',
    { texto: 'Propriedades', icone: ic.propriedades, acao: () => window.api.propriedades(caminho) },
  ].filter(Boolean);
}

$('lateral').addEventListener('contextmenu', async (ev) => {
  const linha = ev.target.closest('.item');
  if (!linha || !linha.dados || linha.querySelector('input')) return;
  ev.preventDefault();
  fecharMenu();
  const pedido = pedidosDeMenu;
  linha.classList.add('alvo-do-menu');
  const opcoes = await window.api.opcoesDoMenu(linha.dados.caminho, linha.dados.ehPasta);
  if (pedido !== pedidosDeMenu) return; // fechou ou clicou em outro enquanto esperava
  menuAberto = { raiz: desenharMenu(itensDoMenu(linha, opcoes), true), sub: null };
  posicionar(menuAberto.raiz, ev.clientX, ev.clientY);
});

// ---------- o mesmo menu, agora na aba do terminal ----------

const ERRO_DA_WORKTREE = {
  'fora-de-repo': 'essa aba não está num repositório git',
  'sem-branch': 'essa aba não está numa branch',
  'ja-e-worktree': 'essa aba já está numa worktree',
  'ja-e-a-principal': 'essa é a branch da pasta principal',
  'sem-main': 'esse repositório não tem main nem master',
  mexido: 'tem arquivo mexido sem commit; a branch não pode mudar de casa',
};

let iconesDaAba = null; // vêm do sistema uma vez só

// A pasta principal do repositório mora na main (ou na master): worktree
// dessas duas não existe, e o item fica apagado.
const BRANCHES_DA_PRINCIPAL = ['main', 'master'];

function itensDaAba(id) {
  const t = terminais.get(id);
  const branch = t.info && t.info.branch;
  const ic = iconesDaAba || {};
  const i = colunas.indexOf(t.col);
  const sozinho = idsDaColuna(t.col).length === 1;
  return [
    // sozinho na coluna, mostrar ao lado não muda nada: fica desligado
    { texto: 'Mostrar ao lado', icone: ic.lado, desligado: sozinho, acao: () => mostrarAoLado(id) },
    { texto: 'Mover pra coluna da esquerda', icone: ic.esquerda, desligado: i < 1, acao: () => moverTerminal(id, colunas[i - 1]) },
    { texto: 'Mover pra coluna da direita', icone: ic.direita, desligado: i === colunas.length - 1, acao: () => moverTerminal(id, colunas[i + 1]) },
    '-',
    branch && !BRANCHES_DA_PRINCIPAL.includes(branch)
      ? { texto: `Abrir worktree de ${branch}`, icone: ic.worktree, acao: () => abrirWorktree(id) }
      : { texto: 'Abrir worktree', icone: ic.worktree, desligado: true },
    '-',
    { texto: 'Renomear aba…', icone: ic.renomear, acao: () => renomearAba(id) },
    { texto: 'Fechar terminal', icone: ic.fechar, acao: () => fecharTerminal(id) },
  ];
}

$('colunas').addEventListener('contextmenu', async (ev) => {
  const aba = ev.target.closest('.aba');
  if (!aba || !aba.dados || aba.querySelector('input')) return;
  ev.preventDefault();
  fecharMenu();
  const pedido = pedidosDeMenu;
  abaDoMenu = aba.dados.id;
  aba.classList.add('alvo-do-menu');
  if (!iconesDaAba) iconesDaAba = await window.api.iconesDaAba().catch(() => ({}));
  if (pedido !== pedidosDeMenu) return; // fechou ou clicou em outro enquanto esperava
  menuAberto = { raiz: desenharMenu(itensDaAba(aba.dados.id), true), sub: null };
  posicionar(menuAberto.raiz, ev.clientX, ev.clientY);
});

// A branch sai da pasta de origem e passa a morar numa pasta nova, ao lado do
// repositório; o terminal novo já abre lá dentro, no mesmo grupo de abas.
async function abrirWorktree(id) {
  const t = terminais.get(id);
  if (!t || !t.info || !t.info.cwd) return;
  const r = await window.api.abrirWorktree(t.info.cwd).catch(() => ({ erro: 'falhou' }));
  if (r.erro) return avisar(ERRO_DA_WORKTREE[r.erro] || 'não consegui abrir a worktree');
  await criarTerminal(r.caminho, t.col); // na mesma coluna da aba de origem
  atualizarInfo(id); // a aba de origem já está em outra branch
}

// Nome escolhido na mão, igual ao renomear da lateral. Apagar tudo e dar Enter
// devolve a aba pro nome automático (a pasta, a branch, o programa rodando).
async function renomearAba(id) {
  const aba = [...$('colunas').querySelectorAll('.aba')].find((el) => el.dados && el.dados.id === id);
  const t = terminais.get(id);
  if (!aba || !t) return;
  const titulo = aba.querySelector('.titulo');
  titulo.hidden = true;
  const nome = await pedirNome(aba, tituloDaAba(t), false, false);
  titulo.hidden = false;
  if (nome === null) return;
  t.nome = nome || null;
  desenharAbas();
}

// Fecha ao clicar fora, rolar fora, trocar de janela ou mudar o tamanho.
// Com o menu aberto, Esc só fecha o menu e não chega no terminal.
window.addEventListener('mousedown', (ev) => {
  if (!ev.target.closest('.menu')) fecharMenu();
}, true);
window.addEventListener('wheel', (ev) => {
  if (!ev.target.closest('.menu')) fecharMenu();
}, true);
window.addEventListener('blur', fecharMenu);
window.addEventListener('resize', fecharMenu);
window.addEventListener('keydown', (ev) => {
  if (!menuAberto) return;
  if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.stopPropagation();
  }
  fecharMenu();
}, true);

async function apagar(linha, modo) {
  const { caminho } = linha.dados;
  const pedido = modo === 'lixeira' ? window.api.lixeira(caminho) : window.api.excluir(caminho);
  const r = await pedido.catch(() => ({ erro: 'falhou' }));
  if (r.cancelado) return;
  if (r.erro) return avisar(modo === 'lixeira' ? 'não consegui mover pra lixeira' : 'não consegui excluir');
  for (const c of [...pastasAbertas]) if (dentroDe(c, caminho)) pastasAbertas.delete(c);
  await recarregarPasta(pastaDe(caminho));
}

async function compactar(linha) {
  const { caminho } = linha.dados;
  const r = await window.api.compactar(caminho).catch(() => ({ erro: 'falhou' }));
  if (r.erro) return avisar('não consegui compactar');
  await recarregarPasta(pastaDe(caminho));
}

// Caixa de nome na própria linha da lateral, igual ao Dolphin: Enter confirma,
// Esc ou clicar fora cancela. Responde o nome digitado, ou null se cancelou.
function pedirNome(linha, inicial, separarExtensao, ehArquivo = true) {
  return new Promise((resolve) => {
    const caixa = document.createElement('input');
    caixa.className = 'caixa-nome';
    caixa.value = inicial;
    caixa.spellcheck = false;
    const arrastavel = linha.draggable;
    linha.draggable = false; // senão selecionar o texto com o mouse arrastaria a linha
    linha.appendChild(caixa);
    caixa.focus();
    // Já vem selecionado só o nome, sem a extensão, pra digitar por cima.
    const ponto = inicial.lastIndexOf('.');
    caixa.setSelectionRange(0, separarExtensao && ponto > 0 ? ponto : inicial.length);

    let terminou = false;
    const terminar = (nome) => {
      if (terminou) return;
      terminou = true;
      caixa.remove();
      linha.draggable = arrastavel;
      resolve(nome);
    };
    caixa.addEventListener('click', (ev) => ev.stopPropagation()); // não abre/fecha a pasta
    // Trocar de janela também tira o foco da caixa; aí ela fica esperando a volta.
    caixa.addEventListener('blur', () => { if (document.hasFocus()) terminar(null); });
    caixa.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') terminar(null);
      if (ev.key !== 'Enter') return;
      const nome = caixa.value.trim();
      if (ehArquivo && (nome.includes('/') || nome === '.' || nome === '..')) {
        avisar('o nome não pode ter "/" nem ser "." ou ".."');
        return;
      }
      // nome de arquivo vazio é cancelar; nome de aba vazio é voltar pro automático
      terminar(ehArquivo ? (nome || null) : nome);
    });
  });
}

async function renomear(linha) {
  const { caminho, nome, ehPasta } = linha.dados;
  const texto = linha.querySelector('span');
  texto.hidden = true;
  const novo = await pedirNome(linha, nome, !ehPasta);
  texto.hidden = false;
  if (!novo || novo === nome) return;

  const destino = pastaDe(caminho) + '/' + novo;
  const r = await window.api.renomear(caminho, destino).catch(() => ({ erro: 'falhou' }));
  if (r.erro) return avisar(r.erro === 'existe' ? 'já existe um item com esse nome' : 'não consegui renomear');

  // O que estava aberto continua aberto, agora com o nome novo. O editor
  // precisa saber, senão o próximo salvar recriaria o arquivo com o nome velho.
  for (const c of [...pastasAbertas]) {
    if (dentroDe(c, caminho)) {
      pastasAbertas.delete(c);
      pastasAbertas.add(destino + c.slice(caminho.length));
    }
  }
  if (dentroDe(arquivoAberto, caminho)) {
    arquivoAberto = destino + arquivoAberto.slice(caminho.length);
    $('nome-arquivo').textContent = arquivoAberto;
  }
  await recarregarPasta(pastaDe(caminho));
}

// Na pasta, cria dentro dela; no arquivo, cria na pasta onde ele está.
async function criarNovo(linha, ehPasta) {
  let dir, recipiente, nivel;
  if (linha.dados.ehPasta) {
    await alternarPasta(linha, true);
    dir = linha.dados.caminho;
    recipiente = linha.dados.filhos;
    nivel = linha.dados.nivel + 1;
  } else {
    dir = pastaDe(linha.dados.caminho);
    ({ recipiente, nivel } = pastasLidas.get(dir));
  }

  const provisoria = document.createElement('div');
  provisoria.className = 'item';
  provisoria.style.paddingLeft = 8 + nivel * 14 + 'px';
  provisoria.innerHTML = icone('', ehPasta);
  recipiente.prepend(provisoria);
  const nome = await pedirNome(provisoria, '', false);
  provisoria.remove();
  if (!nome) return;

  const r = await window.api.criar(dir + '/' + nome, ehPasta).catch(() => ({ erro: 'falhou' }));
  if (r.erro) return avisar(r.erro === 'existe' ? 'já existe um item com esse nome' : 'não consegui criar');
  await recarregarPasta(dir);
}

// ============================================================
// EDITOR
// ============================================================

require.config({ paths: { vs: 'node_modules/monaco-editor/min/vs' } });

let editor = null;
let arquivoAberto = null;
let mtimeAberto = null; // o mtime do que a janela leu ou gravou por último
let salvarAgendado = null; // espera da gravação automática

function monacoPronto() {
  return new Promise((resolve) => require(['vs/editor/editor.main'], () => {
    ligarChecagem();
    resolve();
  }));
}

// Erro sublinhado enquanto se lê: o Monaco já traz de fábrica a checagem de
// JS/TS, JSON, CSS e companhia — é só dizer o que vale. Em JS e TS fica só o
// erro de escrita (chave não fechada, parêntese sobrando): a checagem de
// sentido reclamaria do que existe, porque ela não enxerga o node_modules nem
// o Node do projeto. JSON, CSS, SCSS e LESS vão completos, que é o padrão.
// HTML não tem checagem no Monaco; linguagem sem checagem simplesmente não
// sublinha nada.
let checagemLigada = false;
function ligarChecagem() {
  if (checagemLigada) return;
  checagemLigada = true;
  const soEscrita = { noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true };
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(soEscrita);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(soEscrita);
}

// Gravação automática: toda mudança salva sozinha (decisão do Matheus; desfazer
// é apagar). A espera curta junta uma sequência de teclas numa gravação só,
// em vez de escrever no disco a cada letra.
function agendarSalvar() {
  clearTimeout(salvarAgendado);
  salvarAgendado = setTimeout(salvar, 400);
}

// Grava já o que estava na espera — chamado antes de trocar ou fechar o
// arquivo, senão a última mudança sairia de cena sem ir pro disco.
function salvarAgora() {
  if (salvarAgendado) salvar();
}

// Aviso curto no canto de baixo da janela, por cima do que estiver na tela.
let avisoAgendado = null;
function avisar(texto) {
  const el = $('aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisoAgendado);
  avisoAgendado = setTimeout(() => { el.hidden = true; }, 3000);
}

// Quebrou por dentro: aparece no aviso em vez de morrer calado no console
// que ninguém abre. O "erro" de laço do ResizeObserver fica de fora: o
// Chromium dispara ele à toa e não quebra nada.
window.addEventListener('error', (ev) => {
  if (!/ResizeObserver/.test(ev.message || '')) avisar('erro interno: ' + ev.message);
});
window.addEventListener('unhandledrejection', (ev) => avisar('erro interno: ' + (ev.reason?.message || ev.reason)));

// ---------- Visor de mídia: imagem, áudio, vídeo e PDF ----------
// Tudo dentro da própria janela: o Chromium que desenha a Bigorna já sabe
// mostrar imagem, tocar som e vídeo e ler PDF — nada abre programa de fora.

const TIPOS_DE_MIDIA = [
  ['imagem', /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i],
  ['audio', /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|weba)$/i],
  ['video', /\.(mp4|webm|mkv|mov|m4v|ogv)$/i],
  ['pdf', /\.pdf$/i],
  ['jogo', /\.(sfc|smc|fig|nes|gb|gbc|gba|gen|smd|sms|gg|a26)$/i], // .md fica de fora: é Markdown, não Mega Drive
];

function tipoDeMidia(caminho) {
  const achado = TIPOS_DE_MIDIA.find(([, extensoes]) => extensoes.test(caminho));
  return achado ? achado[0] : null;
}

// O endereço file:// do arquivo. Cada pedaço do caminho é codificado (espaço,
// "#" etc.) e o "?v=" muda a cada abertura, senão o Chromium mostraria a
// versão guardada em cache de um arquivo que acabou de mudar.
function enderecoDoArquivo(caminho) {
  return 'file://' + caminho.split('/').map(encodeURIComponent).join('/') + '?v=' + Date.now();
}

// Para o som e esvazia o visor. Tirar o src solta o arquivo de verdade: só
// remover o elemento deixaria o áudio tocando até a limpeza de memória passar.
function limparVisor() {
  const tocando = $('visor').querySelector('audio, video');
  if (tocando) {
    tocando.pause();
    tocando.removeAttribute('src');
  }
  $('visor').replaceChildren();
}

// Tira o editor de cena e põe o visor na frente. Serve pra mídia e pro jogo.
function visorNaFrente(caminho) {
  // O texto que estava no editor sai de cena (a automática já gravou).
  if (editor) {
    const modelo = editor.getModel();
    editor.setModel(null);
    if (modelo) modelo.dispose();
  }
  $('editor').classList.add('escondido');
  $('visor').hidden = false;
  arquivoAberto = caminho;
  $('nome-arquivo').textContent = caminho;
  $('estado-arquivo').textContent = '';
  mostrarPeca(true);
}

async function abrirMidia(caminho, tipo) {
  limparVisor();
  visorNaFrente(caminho);
  const alvo = $('visor');

  const endereco = enderecoDoArquivo(caminho);
  let el;
  if (tipo === 'imagem') {
    el = document.createElement('img');
  } else if (tipo === 'pdf') {
    el = document.createElement('iframe'); // o visor de PDF do próprio Chromium
  } else {
    el = document.createElement(tipo); // 'audio' ou 'video', com os controles
    el.controls = true;
  }
  el.src = endereco;

  // Arquivo que o Chromium não consegue ler (ex.: vídeo em formato raro).
  if (tipo !== 'pdf') {
    el.addEventListener('error', () => {
      avisar(tipo === 'imagem' ? 'não consegui mostrar essa imagem' : 'não consegui tocar esse arquivo');
      fecharArquivo();
    });
  }

  // Áudio ganha o nome do arquivo em cima, senão fica só uma barra solta.
  let mostrado = el;
  if (tipo === 'audio') {
    mostrado = document.createElement('div');
    mostrado.className = 'toca-audio';
    const nome = document.createElement('p');
    nome.textContent = caminho.slice(caminho.lastIndexOf('/') + 1);
    mostrado.append(nome, el);
  }

  alvo.append(mostrado);
  atualizarTrilho(); // agora o visor tem o que acender
}

// ---------- Fliperama: o console mora na área dos terminais ----------
// O arquivo do jogo é a fita; o emulador ("core") é o aparelho que lê ela.
// Cada console tem o seu, e a extensão do arquivo diz qual chamar. O core é
// baixado uma vez pelo processo principal e fica guardado — daí em diante o
// jogo abre sem internet.
// O fliperama entra sempre pela direita, com uma aba própria na barra da
// coluna. Com uma coluna só, ele vira uma coluna nova ao lado dela, em pé:
// prateleira em cima, tela embaixo, atalhos no pé. Com terminal na coluna
// dele, entra na metade de baixo, deitado: tela à esquerda, prateleira e
// atalhos à direita, com a divisa arrastável. Fechar o último terminal da
// coluna devolve a coluna inteira pra ele.

const CORE_DO_JOGO = [
  [/\.(sfc|smc|fig)$/i, 'snes9x'],              // Super Nintendo
  [/\.nes$/i, 'fceumm'],                        // Nintendinho
  [/\.(gb|gbc)$/i, 'gambatte'],                 // Game Boy e Game Boy Color
  [/\.gba$/i, 'mgba'],                          // Game Boy Advance
  [/\.(gen|smd|sms|gg)$/i, 'genesis_plus_gx'],    // Mega Drive, Master System e Game Gear
  [/\.a26$/i, 'stella2014'],                    // Atari 2600
];

// Cada console tinha o seu formato de tela; sem isso a imagem sai esticada.
const FORMATO_DA_TELA = {
  gambatte: '10 / 9',  // Game Boy e Game Boy Color
  mgba: '3 / 2',       // Game Boy Advance
};                     // o resto é 4 / 3, o formato da TV da época

let jogo = null;       // emulador rodando agora, se houver
let jogoPedido = null; // arquivo que está sendo preparado (o clique pode mudar no meio)
let jogoAtual = null;  // o que está rodando: é dele o ponto que se salva
let fliperama = null;  // o aparelho na tela: { col, el, divisa, tela, rotulo, prateleira }

const temFliperama = (col) => !!fliperama && fliperama.col === col;

// O ponto fica em disco, um por jogo. Sair guarda; abrir de novo continua dali.
async function guardarPonto() {
  if (!jogo || !jogoAtual) return false;
  const { state } = await jogo.saveState();
  const bytes = new Uint8Array(await state.arrayBuffer());
  const r = await window.api.guardarPonto(jogoAtual, bytes).catch(() => ({ erro: 'gravar' }));
  return !r.erro;
}

async function voltarAoPonto() {
  if (!jogo || !jogoAtual) return false;
  const r = await window.api.lerPonto(jogoAtual).catch(() => ({ erro: 'ler' }));
  if (r.erro) return false;
  await jogo.loadState(r.bytes);
  if (fliperama) fliperama.tela.focus();
  return true;
}

// O emulador precisa ser desligado por dentro: só tirar o canvas da tela
// deixaria o jogo rodando e consumindo máquina no escuro.
function desligarEmulador(opcoes) {
  if (jogo) jogo.exit(opcoes);
  jogo = null;
  jogoPedido = null;
  jogoAtual = null;
}

function pedacoDaMesa(classe, texto) {
  const el = document.createElement('div');
  el.className = classe;
  if (texto) el.textContent = texto;
  return el;
}

// O nome da caixa, escrito em cima da linha da moldura: [atalhos], [jogo]…
function rotuloDaMesa(nome, detalhe) {
  const rot = document.createElement('div');
  rot.className = 'rot';
  const on = document.createElement('span');
  on.className = 'seg on';
  on.textContent = nome;
  rot.append(on);
  if (detalhe) {
    const seg = document.createElement('span');
    seg.className = 'seg';
    seg.textContent = detalhe;
    rot.append(seg);
  }
  return rot;
}

// tecla: a letra do atalho (ctrl + ela), mostrada na frente do nome.
function botaoDaMesa(texto, aoClicar, tecla) {
  const b = document.createElement('button');
  b.className = 'mesa-botao';
  if (tecla) {
    const t = document.createElement('span');
    t.className = 'tecla';
    t.textContent = 'ctrl+' + tecla;
    b.append(t);
    b.tecla = tecla;
  }
  b.rotulo = document.createElement('span');
  b.rotulo.textContent = texto;
  b.append(b.rotulo);
  b.tabIndex = -1; // clicar aqui não tira o teclado da tela do jogo
  b.addEventListener('mousedown', (ev) => ev.preventDefault());
  b.addEventListener('click', aoClicar);
  return b;
}

// A coluna onde o fliperama entra: a última, se já houver mais de uma (ou se
// ela estiver sem terminal); senão uma nova, à direita da única que existe.
function colunaDoFliperama() {
  const ultima = colunas[colunas.length - 1];
  if (ultima && (colunas.length > 1 || !idsDaColuna(ultima).length)) return ultima;
  return criarColuna();
}

// Em pé ou deitado, conforme a coluna tenha ou não terminal. Chamado pelo
// desenharAbas, que já roda a cada mudança de terminal ou de coluna.
function arrumarFliperama() {
  if (!fliperama) return;
  const { col, el, divisa } = fliperama;
  const metade = idsDaColuna(col).length > 0;
  el.classList.toggle('metade', metade);
  col.el.classList.toggle('fl-inteira', !metade);
  divisa.hidden = !metade;
  if (!metade) el.style.flexBasis = ''; // a altura arrastada era da metade
  ajustarTela();
}

// A aba do fliperama na barra da coluna, igual às dos terminais. Fica ativa
// (entre colchetes) com o teclado dentro dele.
function abaDoFliperama() {
  const aba = document.createElement('span');
  const focado = fliperama.el.contains(document.activeElement);
  aba.className = 'aba' + (focado ? ' ativa' : '');
  const titulo = Object.assign(document.createElement('span'), {
    className: 'titulo',
    textContent: nomeDoJogo(jogoAtual || jogoPedido) || 'fliperama',
  });
  aba.appendChild(titulo);
  const x = document.createElement('span');
  x.className = 'x';
  x.textContent = '×';
  x.title = 'Sair do jogo (salva o ponto)';
  x.addEventListener('click', (ev) => {
    ev.stopPropagation();
    fecharFliperama();
  });
  aba.appendChild(x);
  aba.addEventListener('click', () => fliperama.tela.focus());
  return aba;
}

// Liga o aparelho. Sem arquivo, mostra só a prateleira — é o que o botão do
// trilho faz: liga o videogame e deixa escolher o que jogar. Já ligado, só
// troca a fita.
async function abrirFliperama(caminho) {
  if (fliperama) {
    if (caminho) await rodarJogo(caminho);
    else fliperama.tela.focus();
    return;
  }
  if ($('terminal-area').hidden) alternarTerminal(); // a casa dele estava escondida (Ctrl+J)

  const el = pedacoDaMesa('fliperama');
  const tela = document.createElement('canvas');
  tela.className = 'jogo';
  tela.tabIndex = 0; // sem isso o canvas não recebe foco, e o teclado não chega no jogo
  tela.width = 256;  // tamanho de partida com a proporção de um console;
  tela.height = 224; // o emulador troca pelo tamanho real quando o jogo sobe

  const caixaDoJogo = pedacoDaMesa('fl-jogo');
  const rotulo = rotuloDaMesa('jogo', 'escolha um na prateleira');
  caixaDoJogo.append(rotulo, tela);

  const atalhos = pedacoDaMesa('fl-atalhos');
  atalhos.append(rotuloDaMesa('atalhos'));
  const itens = pedacoDaMesa('fl-linha');
  atalhos.append(itens);
  itens.append(
    botaoDaMesa('pausar', (ev) => {
      if (!jogo) return;
      const parado = jogo.getStatus() === 'paused';
      parado ? jogo.resume() : jogo.pause();
      ev.currentTarget.rotulo.textContent = parado ? 'pausar' : 'continuar';
      tela.focus();
    }, 'p'),
    botaoDaMesa('salvar ponto', async () => {
      avisar(await guardarPonto() ? 'ponto salvo' : 'nenhum jogo rodando');
      tela.focus();
    }, 's'),
    botaoDaMesa('voltar', async () => {
      if (!await voltarAoPonto()) avisar('nenhum ponto salvo ainda');
      tela.focus();
    }, 'v'),
    botaoDaMesa('recomeçar', () => { if (jogo) { jogo.restart(); tela.focus(); } }, 'r'),
    botaoDaMesa('sair (salva)', () => fecharFliperama(), 'q'),
  );

  // Ctrl + letra aciona o atalho sem tirar a mão do jogo. Só vale com o
  // teclado dentro do fliperama (tela do jogo ou prateleira): no terminal e
  // no editor, Ctrl+R, Ctrl+S e companhia continuam sendo deles.
  const porTecla = new Map([...itens.children].filter((b) => b.tecla).map((b) => [b.tecla, b]));
  const atalhoDoFliperama = (ev) => {
    if (!el.isConnected) return window.removeEventListener('keydown', atalhoDoFliperama, true);
    if (!ev.ctrlKey || ev.shiftKey || ev.altKey || !el.contains(document.activeElement)) return;
    const botao = porTecla.get(ev.key.toLowerCase());
    if (!botao) return;
    ev.preventDefault();
    ev.stopPropagation();
    botao.click();
  };
  window.addEventListener('keydown', atalhoDoFliperama, true);

  const prateleira = pedacoDaMesa('fl-prateleira');
  el.append(prateleira, caixaDoJogo, atalhos);

  // A divisa entre o terminal de cima e o fliperama: só aparece na metade.
  const divisa = document.createElement('div');
  divisa.className = 'divisa-linha';
  divisa.title = 'Arraste pra mudar a altura';
  divisa.addEventListener('mousedown', arrastarDivisaDaLinha);

  const col = colunaDoFliperama();
  fliperama = { col, el, divisa, tela, rotulo: rotulo.lastElementChild, prateleira };
  col.el.append(divisa, el);
  $('shell-fim').hidden = true;

  // O teclado no fliperama acende a aba dele e a moldura da coluna.
  el.addEventListener('focusin', () => {
    colunaAtiva = col;
    desenharAbas();
  });
  el.addEventListener('focusout', () => setTimeout(desenharAbas));

  // O espaço mudou de tamanho ou de forma: a tela se reencaixa.
  new ResizeObserver(() => ajustarTela()).observe(el);

  desenharAbas(); // põe a aba e arruma em pé ou deitado
  atualizarTrilho();
  await encherPrateleira(caminho);
  if (caminho) await rodarJogo(caminho);
  else tela.focus();
}

// Desliga o aparelho guardando o ponto. A coluna só dele vai embora junto;
// com terminal em cima, o terminal fica com a coluna inteira.
async function fecharFliperama() {
  if (!fliperama) return;
  await guardarPonto();
  desligarEmulador();
  const { col, el, divisa } = fliperama;
  fliperama = null;
  el.remove();
  divisa.remove();
  col.el.classList.remove('fl-inteira');
  if (!idsDaColuna(col).length) {
    col.ativo = null;
    removerColuna(col); // se era a última coluna, ela fica, vazia
  }
  desenharAbas();
  atualizarTrilho();
  if (!terminais.size) return void ($('shell-fim').hidden = false);
  const t = terminalDaVez();
  if (t && !$('terminal-area').hidden) t.term.focus();
}

// Arrastar a divisa muda quanto da coluna é do terminal e quanto é do jogo.
function arrastarDivisaDaLinha(evInicio) {
  evInicio.preventDefault();
  if (!fliperama) return;
  const hCima = fliperama.col.terminaisEl.getBoundingClientRect().height;
  const baixo = fliperama.el;
  const hBaixo = baixo.getBoundingClientRect().height;
  const y0 = evInicio.clientY;
  document.body.classList.add('arrastando-divisa-linha');
  function mover(ev) {
    const delta = Math.max(120 - hCima, Math.min(ev.clientY - y0, hBaixo - 120));
    baixo.style.flexBasis = (hBaixo - delta) + 'px';
  }
  function soltar() {
    document.body.classList.remove('arrastando-divisa-linha');
    window.removeEventListener('mousemove', mover);
    window.removeEventListener('mouseup', soltar);
  }
  window.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', soltar);
}

// A tela cresce até o limite do espaço mantendo o formato do console (4:3,
// 10:9…). Em pé ela segue a largura da coluna, deitada segue a altura da
// metade, e nos dois casos o outro lado para em 60%, pra prateleira e os
// atalhos não serem engolidos. É feito aqui, e não no CSS, porque o emulador
// escreve tamanho fixo no próprio canvas e o espaço muda de forma.
function ajustarTela() {
  if (!fliperama) return;
  const { el, tela } = fliperama;
  const caixa = tela.parentElement;
  const estilo = getComputedStyle(caixa);
  const [w, h] = (tela.style.aspectRatio || '4 / 3').split('/').map(Number);
  let escala;
  if (el.classList.contains('metade')) {
    const altura = caixa.clientHeight - parseFloat(estilo.paddingTop) - parseFloat(estilo.paddingBottom);
    escala = Math.min(altura / h, (el.clientWidth * 0.6) / w);
  } else {
    const largura = caixa.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
    escala = Math.min(largura / w, (el.clientHeight * 0.6) / h);
  }
  tela.style.setProperty('width', Math.max(0, Math.floor(w * escala)) + 'px', 'important');
  tela.style.setProperty('height', Math.max(0, Math.floor(h * escala)) + 'px', 'important');
}

// A prateleira é a pasta ~/Jogos lida direto: o que estiver lá aparece aqui.
async function encherPrateleira(aberto) {
  const { prateleira } = fliperama;
  prateleira.append(rotuloDaMesa('prateleira', '~/Jogos'));
  const lista = pedacoDaMesa('mesa-itens'); // a parte que rola; o rótulo fica fora dela
  prateleira.append(lista);
  const pasta = (await window.api.home()) + '/Jogos';
  const itens = await window.api.listDir(pasta).catch(() => null);

  if (!itens) return lista.append(pedacoDaMesa('mesa-vazio', 'crie a pasta ~/Jogos e ponha os jogos nela'));
  const jogos = itens.filter((i) => !i.isDir && tipoDeMidia(i.name) === 'jogo');
  if (jogos.length === 0) return lista.append(pedacoDaMesa('mesa-vazio', 'nenhum jogo em ~/Jogos ainda'));

  for (const { name } of jogos) {
    const caminho = pasta + '/' + name;
    const item = botaoDaMesa(name.slice(0, name.lastIndexOf('.')), () => rodarJogo(caminho));
    item.classList.add('mesa-jogo');
    item.caminho = caminho;
    if (caminho === aberto) item.classList.add('tocando');
    lista.append(item);
  }
}

const nomeDoJogo = (caminho) => caminho ? caminho.slice(caminho.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '') : '';

// Troca a fita do aparelho que já está na tela.
async function rodarJogo(caminho) {
  const { tela, rotulo, prateleira } = fliperama;
  for (const b of prateleira.querySelectorAll('.mesa-jogo')) b.classList.toggle('tocando', b.caminho === caminho);
  if (jogo) {
    await guardarPonto(); // trocar de jogo também não perde o de antes
    desligarEmulador({ removeCanvas: false });
  }

  const [, core] = CORE_DO_JOGO.find(([extensoes]) => extensoes.test(caminho));
  tela.style.aspectRatio = FORMATO_DA_TELA[core] || '4 / 3';
  ajustarTela();

  // Na primeira vez de cada console o emulador vem da internet e demora um
  // pouco; o nome em cima avisa, pra tela preta não parecer travada.
  rotulo.textContent = 'preparando o emulador…';
  jogoPedido = caminho;
  desenharAbas(); // a aba já leva o nome do jogo
  const [emulador, fita] = await Promise.all([
    window.api.coreDoJogo(core).catch(() => ({ erro: 'baixar' })),
    window.api.lerBytes(caminho).catch(() => ({ erro: 'leitura' })),
  ]);
  if (jogoPedido !== caminho) return; // clicou noutro jogo enquanto isso
  rotulo.textContent = nomeDoJogo(caminho);

  if (emulador.erro || fita.erro) {
    return avisar(emulador.erro === 'baixar'
      ? 'não consegui baixar o emulador — precisa de internet na primeira vez'
      : fita.erro === 'grande' ? 'esse arquivo de jogo é grande demais'
      : 'não consegui ler esse arquivo');
  }

  try {
    jogo = await Nostalgist.launch({
      core,
      element: tela,
      size: 'auto', // quem manda no tamanho é o console, não o tamanho da janela:
                    // assim a imagem cresce sem esticar nem achatar
      // o jogo só escuta o teclado quando a tela dele está em foco, senão
      // roubaria as teclas do terminal e do editor
      respondToGlobalEvents: false,
      resolveCoreJs: () => ({ fileName: core + '_libretro.js', fileContent: emulador.js }),
      resolveCoreWasm: () => ({ fileName: core + '_libretro.wasm', fileContent: emulador.wasm }),
      rom: { fileName: caminho.slice(caminho.lastIndexOf('/') + 1), fileContent: fita.bytes },
    });
  } catch {
    return avisar('esse arquivo não abriu como jogo');
  }
  if (jogoPedido !== caminho) return; // trocou de jogo enquanto este subia

  jogoAtual = caminho;
  desenharAbas(); // a aba troca "preparando" pelo nome valendo
  await voltarAoPonto(); // tem ponto guardado? cai onde parou da última vez
  tela.focus(); // já entra valendo: o teclado vai pro jogo sem precisar clicar
}

// ============================================================
// TRILHO: a bigorna é o terminal; pastas, editor, visor e fliperama são
// ferramentas penduradas nele. Acesa é a que está na tela.
// ============================================================

// A peça do arquivo (editor, visor ou mesa de jogo) só existe na tela com
// algo aberto; fechada, o terminal fica com o espaço dela.
function mostrarPeca(aberta) {
  $('editor-area').hidden = !aberta;
  ajustarDivisor();
  atualizarTrilho();
}

// A divisa entre o arquivo e o terminal só aparece com os dois na tela.
function ajustarDivisor() {
  $('divisor').hidden = $('editor-area').hidden || $('terminal-area').hidden;
}

// Acende no trilho o que está na tela. Lê direto da tela, pra não ter um
// segundo estado pra manter.
function atualizarTrilho() {
  const visor = $('visor');
  const temMidia = !visor.hidden && visor.childElementCount > 0;
  $('btn-lateral').classList.toggle('ligada', !$('lateral').classList.contains('fechada'));
  $('btn-editor').classList.toggle('ligada', !$('editor').classList.contains('escondido') && !$('editor-area').hidden);
  $('btn-visor').classList.toggle('ligada', temMidia);
  $('btn-jogo').classList.toggle('ligada', !!fliperama);
  $('tipo-peca').textContent = temMidia && $('editor').classList.contains('escondido') ? 'visor' : 'editor';
}

let ultimoTexto = null; // o último arquivo de texto aberto, pro botão do editor reabrir

// Editor: ligado, fecha o arquivo; desligado, reabre o último texto.
$('btn-editor').addEventListener('click', () => {
  if ($('btn-editor').classList.contains('ligada')) return fecharArquivo();
  if (ultimoTexto) abrirArquivo(ultimoTexto);
  else avisar('clique num arquivo de texto na lateral');
});

// Visor: ligado, fecha a mídia; desligado, só diz de onde ela vem.
$('btn-visor').addEventListener('click', () => {
  if ($('btn-visor').classList.contains('ligada')) return fecharArquivo();
  avisar('clique numa imagem, som, vídeo ou PDF na lateral');
});

// Fliperama: desligado, liga o videogame; ligado, sai guardando o ponto.
$('btn-jogo').addEventListener('click', () => {
  if (fliperama) fecharFliperama();
  else abrirFliperama(null);
});

$('btn-fechar-arquivo').addEventListener('click', () => fecharArquivo());

// A bigorna: recolhe tudo e deixa só o terminal.
$('btn-casa').addEventListener('click', async () => {
  $('lateral').classList.add('fechada');
  if (fliperama) await fecharFliperama();
  if (!$('editor-area').hidden) fecharArquivo();
  if ($('terminal-area').hidden) alternarTerminal();
  const t = terminalDaVez();
  if (t) t.term.focus();
  atualizarTrilho();
});

async function abrirArquivo(caminho) {
  salvarAgora(); // o arquivo que está saindo não perde a última mudança

  // Imagem, som, vídeo, PDF e jogo não vão pro editor de texto: abrem no visor.
  const tipo = tipoDeMidia(caminho);
  if (tipo === 'jogo') return abrirFliperama(caminho); // vai pra área dos terminais
  if (tipo) return abrirMidia(caminho, tipo);

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
    // Ctrl+S grava na hora, pro costume não atrapalhar — mas nem precisa:
    // toda mudança já salva sozinha. Forçado: grava mesmo se mudou por fora.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => salvar(true));
    editor.onDidChangeModelContent(agendarSalvar);
  }

  limparVisor();
  $('visor').hidden = true;
  $('editor').classList.remove('escondido');

  const modeloVelho = editor.getModel();
  const modelo = monaco.editor.createModel(r.conteudo, undefined, monaco.Uri.file(caminho));
  editor.setModel(modelo);
  if (modeloVelho) modeloVelho.dispose();

  arquivoAberto = caminho;
  mtimeAberto = r.mtime ?? null;
  ultimoTexto = caminho;
  vigiarPastaDoArquivo(caminho); // mudou por fora, a recarga fica sabendo
  $('nome-arquivo').textContent = caminho;
  $('estado-arquivo').textContent = '';
  mostrarPeca(true);
  editor.focus();
}

// A pasta do arquivo aberto fica vigiada enquanto ele estiver na tela; saindo
// ele, o vigia só fica se a lateral também mostra a pasta.
let pastaVigiadaDoArquivo = null;
function vigiarPastaDoArquivo(caminho) {
  const dir = caminho ? pastaDe(caminho) : null;
  if (pastaVigiadaDoArquivo === dir) return;
  if (pastaVigiadaDoArquivo && !pastasLidas.has(pastaVigiadaDoArquivo)) window.api.desvigiarPasta(pastaVigiadaDoArquivo);
  pastaVigiadaDoArquivo = dir;
  if (dir) window.api.vigiarPasta(dir);
}

// Fecha o que está na tela (texto ou mídia) e volta pra tela de nenhum arquivo.
function fecharArquivo() {
  salvarAgora(); // fechar não perde a última mudança

  limparVisor();
  $('visor').hidden = true;
  if (editor) {
    const modelo = editor.getModel();
    editor.setModel(null);
    if (modelo) modelo.dispose();
  }
  $('editor').classList.add('escondido');
  if (itemAtivo) {
    itemAtivo.classList.remove('aberto-no-editor');
    itemAtivo = null;
  }
  arquivoAberto = null;
  mtimeAberto = null;
  vigiarPastaDoArquivo(null);
  $('nome-arquivo').textContent = 'bigorna';
  $('estado-arquivo').textContent = '';
  mostrarPeca(false);
  const t = terminalDaVez();
  if (t && !$('terminal-area').hidden) t.term.focus(); // sem arquivo, o teclado volta pro terminal
}

async function salvar(forcado) {
  clearTimeout(salvarAgendado);
  salvarAgendado = null;
  // Sem modelo é mídia no visor: salvar aqui escreveria texto em cima dela.
  if (!editor || !editor.getModel() || !arquivoAberto) return;
  try {
    const r = await window.api.writeFile(arquivoAberto, editor.getValue(), forcado ? null : mtimeAberto);
    // Alguém (git, Claude no terminal) mexeu no arquivo depois que a janela
    // leu: gravar agora apagaria a mudança dele. Ctrl+S é quem decide.
    if (r.erro === 'mudou-por-fora') return avisar('o arquivo mudou por fora da Bigorna — Ctrl+S grava por cima');
    mtimeAberto = r.mtime ?? mtimeAberto;
    const agora = new Date();
    const hora = String(agora.getHours()).padStart(2, '0') + ':' + String(agora.getMinutes()).padStart(2, '0');
    $('estado-arquivo').textContent = 'salvo · ' + hora;
  } catch {
    avisar('não consegui salvar (permissão?)');
  }
}

// O arquivo aberto mudou por fora (git, Claude no terminal ao lado): sem
// mudança sua pendente, recarrega sozinho mantendo o cursor; com mudança a
// caminho, fica quieto — o aviso do salvar é quem cuida do conflito.
async function recarregarArquivoAberto() {
  if (!editor || !arquivoAberto || !editor.getModel() || salvarAgendado) return;
  const alvo = arquivoAberto;
  const r = await window.api.readFile(alvo).catch(() => null);
  // o mundo pode ter mudado durante a leitura: confere tudo de novo
  if (!r || r.erro || r.mtime === mtimeAberto || alvo !== arquivoAberto || salvarAgendado) return;
  const modelo = editor.getModel();
  if (!modelo) return;
  mtimeAberto = r.mtime;
  if (r.conteudo === modelo.getValue()) return;
  const vista = editor.saveViewState();
  modelo.pushEditOperations([], [{ range: modelo.getFullModelRange(), text: r.conteudo }], () => null);
  editor.restoreViewState(vista);
}

// Fechar a janela também não perde a última mudança: o processo principal
// segura o fechar até este aviso (o beforeunload sozinho não espera o disco).
window.addEventListener('beforeunload', salvarAgora);
window.api.onVaiFechar(async () => {
  try { await salvar(); } finally { window.api.podeFechar(); }
});

// ============================================================
// Ctrl+J esconde e mostra o terminal (única tecla que a janela
// guarda pra ela; o bash não recebe essa — decisão do Matheus)
// ============================================================

function alternarTerminal() {
  const esconder = !$('terminal-area').hidden;
  $('terminal-area').hidden = esconder;
  $('corpo').classList.toggle('sem-terminal', esconder); // o arquivo fica com a tela toda
  ajustarDivisor();
  if (esconder) {
    if (editor) editor.focus();
  } else {
    const t = terminalDaVez();
    if (t) t.term.focus(); // o ResizeObserver reajusta o tamanho sozinho
  }
}

window.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.code === 'KeyJ') {
    ev.preventDefault();
    ev.stopPropagation();
    alternarTerminal();
  }
}, true); // "true": a janela ouve a tecla antes do terminal e do editor

// ============================================================
// DIVISOR da lateral (largura das pastas)
// ============================================================

$('divisor-lateral').addEventListener('mousedown', (evInicio) => {
  evInicio.preventDefault();
  const lateral = $('lateral');
  const larguraInicio = lateral.getBoundingClientRect().width;
  const xInicio = evInicio.clientX;
  lateral.classList.add('arrastando'); // sem deslize durante o arrasto

  function mover(ev) {
    const nova = Math.min(500, Math.max(140, larguraInicio + ev.clientX - xInicio));
    lateral.style.setProperty('--largura', nova + 'px');
  }
  function soltar() {
    lateral.classList.remove('arrastando');
    window.removeEventListener('mousemove', mover);
    window.removeEventListener('mouseup', soltar);
  }
  window.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', soltar);
});

// ============================================================
// DIVISOR entre o arquivo e o terminal (largura do arquivo)
// ============================================================

$('divisor').addEventListener('mousedown', (evInicio) => {
  evInicio.preventDefault();
  const area = $('editor-area');
  const larguraInicio = area.getBoundingClientRect().width;
  const xInicio = evInicio.clientX;

  function mover(ev) {
    const nova = larguraInicio + (ev.clientX - xInicio);
    area.style.width = Math.max(200, nova) + 'px';
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
  temaDeIcones = await window.api.temaDeIcones().catch(() => null);
  casa = await window.api.home();
  $('raiz-nome').textContent = casa;
  pastasLidas.set(casa, { recipiente: $('arvore'), nivel: 0 });
  await montarPasta(casa, $('arvore'), 0);
  pastaPedida = await window.api.pastaPedida();
  if (dentroDe(pastaPedida, casa)) {
    await revelarPasta(pastaPedida, casa, $('arvore'));
    pastaPedida = null;
  }
  await criarTerminal();
  atualizarTrilho();
  const arquivo = await window.api.arquivoPedido();
  if (arquivo) await abrirPedido(arquivo);
})();
