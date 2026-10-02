/* global Terminal, FitAddon, WebglAddon, require, monaco */

const $ = (id) => document.getElementById(id);

// ============================================================
// TERMINAIS EM ABAS (estilo Konsole, grupos por repositório)
// ============================================================

const OPCOES_DO_TERMINAL = {
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
};

// Cores das etiquetas de grupo. Cada repositório pega a próxima da fila e
// fica com ela; acabando as cores, a fila recomeça.
const CORES_DE_GRUPO = ['#e0b050', '#6aa1e0', '#9ece6a', '#c9a0ff', '#e07878', '#5bc8af'];
const corDoRepo = new Map();
function corDoGrupo(repo) {
  if (!corDoRepo.has(repo)) corDoRepo.set(repo, CORES_DE_GRUPO[corDoRepo.size % CORES_DE_GRUPO.length]);
  return corDoRepo.get(repo);
}

const terminais = new Map(); // id → { term, fit, caixa, info }
let proximoTerminal = 1;
let terminalAtivo = null;
let casa = ''; // pasta pessoal, pro título "~ bash" da aba

const terminalDaVez = () => terminais.get(terminalAtivo) || null;

async function criarTerminal() {
  $('shell-fim').hidden = true;

  const id = proximoTerminal++;
  const caixa = document.createElement('div');
  caixa.className = 'terminal-caixa';
  $('terminais').appendChild(caixa);

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
  terminais.set(id, { term, fit, caixa, info: null });
  term.onData((data) => window.api.ptyWrite(id, data));

  fit.fit();
  await window.api.ptySpawn(id, term.cols, term.rows);
  ativarTerminal(id);
  atualizarInfo(id); // batiza a aba sem esperar a próxima rodada do relógio
  return id;
}

function ativarTerminal(id) {
  terminalAtivo = id;
  for (const [outro, t] of terminais) t.caixa.classList.toggle('escondida', outro !== id);
  const t = terminais.get(id);
  // o tamanho pode ter mudado enquanto a aba estava escondida
  requestAnimationFrame(() => {
    t.fit.fit();
    window.api.ptyResize(id, t.term.cols, t.term.rows);
    t.term.focus();
  });
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
  if (terminalAtivo === id) {
    terminalAtivo = null;
    const resto = [...terminais.keys()];
    if (resto.length) ativarTerminal(resto[resto.length - 1]);
  }
  desenharAbas();
  if (!terminais.size) $('shell-fim').hidden = false;
}

window.api.onPtyData((id, data) => {
  const t = terminais.get(id);
  if (t) t.term.write(data);
});
window.api.onPtyExit((id) => fecharTerminal(id, true));

$('btn-nova-aba').addEventListener('click', () => criarTerminal());
$('btn-reabrir').addEventListener('click', () => criarTerminal());

// Encolheu ou cresceu a área (janela, lateral, divisor): reajusta o da vez.
// Os escondidos se ajustam na hora em que a aba deles é ativada.
let ajustePendente = null;
new ResizeObserver(() => {
  clearTimeout(ajustePendente);
  ajustePendente = setTimeout(() => {
    const t = terminalDaVez();
    if (!t) return;
    t.fit.fit();
    window.api.ptyResize(terminalAtivo, t.term.cols, t.term.rows);
  }, 50);
}).observe($('terminais'));

// ---------- a barra de abas ----------
// De tempo em tempo a Bigorna pergunta de cada terminal: em que pasta está,
// o que roda agora e, se for pasta de repositório git, qual e em que branch.
// Abas do mesmo repositório viram um grupo com etiqueta e linha colorida.

function tituloDaAba(info) {
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
  aba.className = 'aba' + (id === terminalAtivo ? ' ativa' : '');
  if (t.info && t.info.programa === 'claude') {
    const marca = document.createElement('span');
    marca.className = 'claude';
    marca.textContent = '✳';
    marca.title = 'Claude rodando aqui';
    aba.appendChild(marca);
  }
  aba.appendChild(document.createTextNode(tituloDaAba(t.info)));
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
  return aba;
}

function desenharAbas() {
  const grupos = new Map(); // repositório → abas dele, na ordem de abertura
  const soltas = [];
  for (const [id, t] of terminais) {
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
  $('abas-lista').replaceChildren(novas);
}

// ============================================================
// LATERAL DE PASTAS
// ============================================================

const ICONE_PASTA = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.5 2h5l1.5 2h6.5A1.5 1.5 0 0 1 16 5.5v7A1.5 1.5 0 0 1 14.5 14h-13A1.5 1.5 0 0 1 0 12.5v-9A1.5 1.5 0 0 1 1.5 2z" opacity=".85"/></svg>';
const ICONE_PASTA_ABERTA = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M1.5 2h5l1.5 2H14a1 1 0 0 1 1 1v1H3.2a1.5 1.5 0 0 0-1.43 1.05L0 12V3.5A1.5 1.5 0 0 1 1.5 2zm1.7 5h11.6a1 1 0 0 1 .96 1.27l-1.3 4.5a1.5 1.5 0 0 1-1.44 1.08H1.6a1 1 0 0 1-.96-1.28l1.63-4.5A1.5 1.5 0 0 1 3.2 7z"/></svg>';
const ICONE_ARQUIVO = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M3 0h7l3 3v13H3V0zm6.5 1H4v14h8V4.5H9.5V1z" opacity=".7"/></svg>';

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
  el.innerHTML = (ehPasta ? ICONE_PASTA : ICONE_ARQUIVO) + '<span></span>';
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
  linha.firstElementChild.outerHTML = abrir ? ICONE_PASTA_ABERTA : ICONE_PASTA;
  if (abrir) pastasAbertas.add(caminho);
  else pastasAbertas.delete(caminho);
  if (abrir && !pastasLidas.has(caminho)) {
    pastasLidas.set(caminho, { recipiente: filhos, nivel: nivel + 1 });
    await montarPasta(caminho, filhos, nivel + 1);
  }
}

// O vigia avisou que uma pasta mudou (pode ter sido por fora da Bigorna).
window.api.onPastaMudou((dir) => recarregarPasta(dir));

// Relê uma pasta do disco depois de criar, renomear, apagar ou compactar.
async function recarregarPasta(dir) {
  const lida = pastasLidas.get(dir);
  if (!lida) return; // ainda não foi aberta: vai ser lida quando abrir
  for (const c of pastasLidas.keys()) if (c.startsWith(dir + '/')) pastasLidas.delete(c);
  await montarPasta(dir, lida.recipiente, lida.nivel);
}

$('btn-lateral').addEventListener('click', () => {
  $('lateral').classList.toggle('fechada');
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
  const t = terminalDaVez();
  if (!caminho || !t) return;
  ev.preventDefault();
  ev.stopPropagation();
  // paste e não ptyWrite: se o programa aberto pediu "colagem marcada" (o bash
  // e o Claude Code pedem), ele recebe como colagem e não executa nada sozinho.
  t.term.paste(caminhoProBash(caminho) + ' ');
  t.term.focus();
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

$('arvore').addEventListener('contextmenu', async (ev) => {
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
function pedirNome(linha, inicial, separarExtensao) {
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
      if (nome.includes('/') || nome === '.' || nome === '..') {
        avisar('o nome não pode ter "/" nem ser "." ou ".."');
        return;
      }
      terminar(nome || null);
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
  provisoria.innerHTML = ehPasta ? ICONE_PASTA : ICONE_ARQUIVO;
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
let salvarAgendado = null; // espera da gravação automática

function monacoPronto() {
  return new Promise((resolve) => require(['vs/editor/editor.main'], resolve));
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

function avisar(texto) {
  const el = $('nome-arquivo');
  const antes = el.textContent;
  el.textContent = texto;
  setTimeout(() => { el.textContent = antes; }, 3000);
}

// ---------- Visor de mídia: imagem, áudio, vídeo e PDF ----------
// Tudo dentro da própria janela: o Chromium que desenha a Bigorna já sabe
// mostrar imagem, tocar som e vídeo e ler PDF — nada abre programa de fora.

const TIPOS_DE_MIDIA = [
  ['imagem', /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i],
  ['audio', /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|weba)$/i],
  ['video', /\.(mp4|webm|mkv|mov|m4v|ogv)$/i],
  ['pdf', /\.pdf$/i],
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

function abrirMidia(caminho, tipo) {
  limparVisor();

  // O texto que estava no editor sai de cena (a automática já gravou).
  if (editor) {
    const modelo = editor.getModel();
    editor.setModel(null);
    if (modelo) modelo.dispose();
  }
  $('editor').classList.add('escondido');
  $('vazio').classList.add('escondido');

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
      limparVisor();
      $('visor').hidden = true;
      $('vazio').classList.remove('escondido');
      arquivoAberto = null;
      $('nome-arquivo').textContent = 'bigorna';
      avisar(tipo === 'imagem' ? 'não consegui mostrar essa imagem' : 'não consegui tocar esse arquivo');
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

  $('visor').append(mostrado);
  $('visor').hidden = false;

  arquivoAberto = caminho;
  $('nome-arquivo').textContent = caminho;
}

async function abrirArquivo(caminho) {
  salvarAgora(); // o arquivo que está saindo não perde a última mudança

  // Imagem, som, vídeo e PDF não vão pro editor de texto: abrem no visor.
  const tipo = tipoDeMidia(caminho);
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
    // toda mudança já salva sozinha.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, salvar);
    editor.onDidChangeModelContent(agendarSalvar);
  }

  // Se uma mídia estava na tela, sai; o editor volta pro lugar.
  limparVisor();
  $('visor').hidden = true;
  $('editor').classList.remove('escondido');
  $('vazio').classList.add('escondido');

  const modeloVelho = editor.getModel();
  const modelo = monaco.editor.createModel(r.conteudo, undefined, monaco.Uri.file(caminho));
  editor.setModel(modelo);
  if (modeloVelho) modeloVelho.dispose();

  arquivoAberto = caminho;
  $('nome-arquivo').textContent = caminho;
  editor.focus();
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
  $('vazio').classList.remove('escondido');
  if (itemAtivo) {
    itemAtivo.classList.remove('aberto-no-editor');
    itemAtivo = null;
  }
  arquivoAberto = null;
  $('nome-arquivo').textContent = 'bigorna';
}

async function salvar() {
  clearTimeout(salvarAgendado);
  salvarAgendado = null;
  // Sem modelo é mídia no visor: salvar aqui escreveria texto em cima dela.
  if (!editor || !editor.getModel() || !arquivoAberto) return;
  try {
    await window.api.writeFile(arquivoAberto, editor.getValue());
  } catch {
    avisar('não consegui salvar (permissão?)');
  }
}

// Fechar a janela também não perde a última mudança.
window.addEventListener('beforeunload', salvarAgora);

// ============================================================
// Ctrl+J esconde e mostra o terminal (única tecla que a janela
// guarda pra ela; o bash não recebe essa — decisão do Matheus)
// ============================================================

window.addEventListener('keydown', (ev) => {
  if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.code === 'KeyJ') {
    ev.preventDefault();
    ev.stopPropagation();
    const esconder = !$('terminal-area').hidden;
    $('terminal-area').hidden = esconder;
    $('divisor').hidden = esconder;
    if (esconder) {
      if (editor) editor.focus();
    } else {
      const t = terminalDaVez();
      if (t) t.term.focus(); // o ResizeObserver reajusta o tamanho sozinho
    }
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
  casa = await window.api.home();
  $('raiz-nome').textContent = casa;
  pastasLidas.set(casa, { recipiente: $('arvore'), nivel: 0 });
  await montarPasta(casa, $('arvore'), 0);
  await criarTerminal();
})();
