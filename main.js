const { app, BrowserWindow, Menu, ipcMain, dialog, net, nativeImage, shell: sistema } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { watch: vigiar, statSync, rmSync, mkdirSync, chmodSync, appendFileSync, constants: fsc } = require('fs');
const { fileURLToPath } = require('url');
const { execFile, spawn } = require('child_process');
const net_ = require('net');
const pty = require('node-pty');

let win = null;
const shells = new Map(); // id do terminal (dado pela janela) → pty

// Quebrou por dentro, fica anotado: sem isso, "abri e não veio janela" não
// deixa rastro nenhum. O arquivo fica na pasta de configuração.
function anotarErro(origem, erro) {
  const linha = `${new Date().toISOString()} [${origem}] ${erro?.stack || erro}\n`;
  try { appendFileSync(path.join(app.getPath('userData'), 'erros.log'), linha); } catch { /* sem onde anotar */ }
  console.error(linha.trim());
}
process.on('uncaughtException', (erro) => anotarErro('inesperado', erro));
process.on('unhandledRejection', (erro) => anotarErro('promessa', erro));

// Pedido de quem abriu a Bigorna como terminal do sistema, do jeito que o KDE
// e os outros programas pedem pro Konsole: `--workdir <pasta>` abre o primeiro
// terminal nessa pasta (sem ele, vale a pasta de onde a Bigorna foi aberta) e
// `-e <comando…>` roda o comando no lugar do bash, fechando a janela quando ele sai.
// Uma pasta solta (ou file://…) é o "abrir pasta" dos outros programas: o terminal
// abre nela e a lateral desce até ela. Um arquivo solto vai pro editor (ou visor).
function lerPedido() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const pedido = { pasta: process.cwd() !== '/' ? process.cwd() : null, comando: null, revelar: null, arquivo: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workdir') pedido.pasta = args[++i] || pedido.pasta;
    else if (args[i].startsWith('--workdir=')) pedido.pasta = args[i].slice(10);
    else if (!args[i].startsWith('-')) {
      let alvo = args[i];
      try { if (alvo.startsWith('file://')) alvo = fileURLToPath(alvo); } catch { continue; }
      alvo = path.resolve(alvo);
      let info = null;
      try { info = statSync(alvo, { throwIfNoEntry: false }); } catch { continue; } // sem permissão de olhar: ignora
      if (!info) continue;
      pedido.pasta = pedido.revelar = info.isDirectory() ? alvo : path.dirname(alvo);
      pedido.arquivo = info.isDirectory() ? null : alvo;
    } else if (args[i] === '-e') {
      const resto = args.slice(i + 1);
      // Um texto só ("htop -d 5", com espaço ou |) vai pelo bash; vários já vêm separados.
      if (resto.length === 1) pedido.comando = ['/bin/bash', ['-c', resto[0]]];
      else if (resto.length > 1) pedido.comando = [resto[0], resto.slice(1)];
      break;
    }
  }
  return pedido;
}
let pedido = lerPedido(); // vale só pro primeiro terminal; depois vira null
const pastaPedida = pedido.revelar;
const arquivoPedido = pedido.arquivo;

// ---------- arquivo pedido vai pra janela que já está aberta ----------
// Uma tomada única em /run/user/<id>/bigorna: a janela em foco toma ela pra
// si ao ganhar o foco. Quem nasce só pra abrir um arquivo entrega o caminho
// ali e sai sem abrir janela — mas só se quem recebeu confirmar; sem
// confirmação, segue e abre a própria janela.
const pastaDasTomadas = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), 'bigorna');
const tomadaDaVez = path.join(pastaDasTomadas, 'atual.sock');
const CONFIRMACAO = Buffer.from([6]); // ACK: "recebi e vou abrir"

// A pasta precisa ser só do usuário (modo 700): caindo em /tmp (sem
// XDG_RUNTIME_DIR), outro usuário poderia criar ela antes e interceptar os
// caminhos entregues. Pasta estranha = a entrega fica desligada, e só ela.
let pastaConferida = null;
function pastaSegura() {
  if (pastaConferida !== null) return pastaConferida;
  try {
    mkdirSync(pastaDasTomadas, { recursive: true, mode: 0o700 });
    let info = statSync(pastaDasTomadas);
    if (info.uid === process.getuid() && (info.mode & 0o077) !== 0) {
      chmodSync(pastaDasTomadas, 0o700);
      info = statSync(pastaDasTomadas);
    }
    pastaConferida = info.isDirectory() && info.uid === process.getuid() && (info.mode & 0o077) === 0;
  } catch {
    pastaConferida = false;
  }
  if (!pastaConferida) console.error('[tomada] pasta insegura ou inacessível, entrega desligada:', pastaDasTomadas);
  return pastaConferida;
}

async function entregarPraJanelaAberta(arquivo) {
  if (!pastaSegura()) return false;
  // A janela em foco pode estar trocando a tomada de mão neste instante: uma
  // segunda tentativa cobre esse vão.
  if (await tentarEntrega(arquivo)) return true;
  await new Promise((r) => setTimeout(r, 150));
  return tentarEntrega(arquivo);
}

function tentarEntrega(arquivo) {
  return new Promise((resolve) => {
    const ligacao = net_.connect(tomadaDaVez);
    let confirmou = false;
    ligacao.setTimeout(1500, () => ligacao.destroy());
    ligacao.on('error', () => {});
    ligacao.on('connect', () => ligacao.end(arquivo)); // o caminho cru, sem mexer nele
    ligacao.on('data', () => { confirmou = true; }); // qualquer resposta é o "recebi"
    ligacao.on('close', () => resolve(confirmou));
  });
}

// A janela ganhou o foco: toma a tomada pra si (sai da mão de quem tinha).
let tomada = null; // o servidor escutando, se for desta janela
let inoDaTomada = null; // pra saber se o arquivo da tomada ainda é o nosso
function tomarATomada() {
  if (!pastaSegura()) return;
  try {
    // já é nossa e ninguém tomou nesse meio tempo: nada a fazer
    if (tomada && statSync(tomadaDaVez, { throwIfNoEntry: false })?.ino === inoDaTomada) return;
    if (tomada) tomada.close();
    tomada = null;
    rmSync(tomadaDaVez, { force: true });
  } catch (erro) {
    return console.error('[tomada] não consegui tomar:', erro.message);
  }
  const servidor = net_.createServer((ligacao) => {
    const pedacos = [];
    ligacao.on('error', () => {});
    ligacao.on('data', (d) => pedacos.push(d));
    ligacao.on('end', () => {
      const arquivo = Buffer.concat(pedacos).toString('utf8');
      if (path.isAbsolute(arquivo) && abrirNaJanela(arquivo)) ligacao.end(CONFIRMACAO);
      else ligacao.end(); // sem confirmação: quem mandou abre a própria janela
    });
  });
  servidor.on('error', (erro) => {
    console.error('[tomada] parou de escutar:', erro.message);
    if (tomada === servidor) tomada = null;
  });
  servidor.listen(tomadaDaVez, () => {
    inoDaTomada = statSync(tomadaDaVez, { throwIfNoEntry: false })?.ino ?? null;
  });
  tomada = servidor;
}

app.on('will-quit', () => {
  if (!tomada) return;
  tomada.close();
  // só apaga se o arquivo ainda é o nosso: outra janela pode ter tomado
  try {
    if (statSync(tomadaDaVez, { throwIfNoEntry: false })?.ino === inoDaTomada) rmSync(tomadaDaVez, { force: true });
  } catch { /* já foi */ }
});

// Entrega o pedido na janela: direto, ou guardado pra quando ela terminar de
// carregar — mandado antes disso, o aviso se perderia no vazio.
const esperandoAJanela = [];
function abrirNaJanela(arquivo) {
  if (!win) return false;
  if (win.webContents.isLoading()) esperandoAJanela.push(arquivo);
  else win.webContents.send('abrir-arquivo', arquivo);
  if (win.isMinimized()) win.restore();
  win.focus();
  return true;
}

function criarJanela() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    backgroundColor: '#0a0a0a',
    title: 'bigorna',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      plugins: true, // liga o visor de PDF do Chromium (o PDF abre num iframe)
    },
  });

  // Sem menu: nenhum atalho do Electron captura tecla (Ctrl+W, Ctrl+R etc.).
  Menu.setApplicationMenu(null);

  win.loadFile('index.html');

  win.on('focus', tomarATomada);
  tomarATomada();

  win.webContents.on('did-finish-load', () => {
    while (esperandoAJanela.length) win.webContents.send('abrir-arquivo', esperandoAJanela.shift());
  });

  // Fechar espera a última gravação do editor chegar no disco: a janela avisa
  // quando salvou (ou vale 1s, se o renderer estiver travado) e aí fecha.
  let podeFechar = false;
  win.on('close', (ev) => {
    if (podeFechar) return;
    ev.preventDefault();
    const seguir = () => {
      if (podeFechar) return;
      podeFechar = true;
      ipcMain.removeListener('janela:pode-fechar', seguir);
      if (win) win.close();
    };
    ipcMain.once('janela:pode-fechar', seguir);
    win.webContents.send('janela:vai-fechar');
    setTimeout(seguir, 1000);
  });

  win.on('closed', () => {
    win = null;
    for (const p of shells.values()) p.kill();
    shells.clear();
  });
}

// ---------- Terminal (pty = o "fio" que liga a tela ao bash de verdade) ----------

ipcMain.handle('pty:spawn', async (_ev, id, cols, rows, pasta) => {
  const inicio = pedido;
  pedido = null;
  if (!pasta && inicio) pasta = inicio.pasta;
  const [programa, args] = inicio?.comando || [process.env.SHELL || '/bin/bash', []];
  const dentroDe = pasta && path.isAbsolute(pasta)
    && await fs.stat(pasta).then((e) => e.isDirectory(), () => false)
    && await fs.access(pasta, fsc.X_OK).then(() => true, () => false); // pasta sem permissão de entrar mata o bash
  let p;
  try {
    p = pty.spawn(programa, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: dentroDe ? pasta : os.homedir(),
      env: process.env,
    });
  } catch (erro) {
    console.log('[pty] não abriu', programa, erro.message);
    if (inicio?.comando && win) win.close();
    return false;
  }
  shells.set(id, p);
  console.log('[pty] terminal', id, 'aberto: pid', p.pid, 'tamanho', cols, 'x', rows);
  p.onData((data) => {
    if (win) win.webContents.send('pty:data', id, data);
  });
  p.onExit(({ exitCode, signal }) => {
    console.log('[pty] terminal', id, 'encerrou: código', exitCode, 'sinal', signal);
    shells.delete(id);
    infoDeGit.delete(id);
    if (inicio?.comando) { if (win) win.close(); return; }
    if (win) win.webContents.send('pty:exit', id, exitCode);
  });
  return true;
});

ipcMain.on('pty:write', (_ev, id, data) => {
  const p = shells.get(id);
  if (p) p.write(data);
});

ipcMain.on('pty:resize', (_ev, id, cols, rows) => {
  const p = shells.get(id);
  if (p && cols > 0 && rows > 0) p.resize(cols, rows);
});

ipcMain.on('pty:kill', (_ev, id) => {
  const p = shells.get(id);
  if (p) p.kill();
});

// O que a aba do terminal mostra: a pasta em que ele está, o programa rodando
// agora e, se a pasta for de um repositório git, qual repositório e qual
// branch. Worktrees respondem o mesmo repositório — é por isso que dois
// Claude Codes da mesma base caem no mesmo grupo sozinhos.
// O repositório fica guardado por terminal enquanto a pasta não muda, e a
// branch sai do arquivo HEAD direto: subir um git por aba a cada 3 segundos
// custava caro; ler um arquivo não custa nada.
const infoDeGit = new Map(); // id → { cwd, repo, nome, gitdir } (só quando é repositório)

async function infoDoRepositorio(id, cwd) {
  const guardado = infoDeGit.get(id);
  if (!guardado || guardado.cwd !== cwd) {
    infoDeGit.delete(id);
    let saida;
    try {
      saida = await rodar('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--git-dir']);
    } catch { return null; } // fora de repositório (não guarda: um git init aparece sozinho)
    const [comum, gitdir] = saida.trim().split('\n');
    const repo = path.dirname(comum);
    infoDeGit.set(id, { cwd, repo, nome: path.basename(repo), gitdir });
  }
  const dados = infoDeGit.get(id);
  const head = await fs.readFile(path.join(dados.gitdir, 'HEAD'), 'utf8').catch(() => '');
  if (!head) { infoDeGit.delete(id); return null; } // o .git sumiu: na próxima, pergunta de novo
  const ref = head.match(/^ref: refs\/heads\/(.+)$/m);
  return { repo: dados.repo, nome: dados.nome, branch: ref ? ref[1] : 'HEAD' };
}

ipcMain.handle('pty:info', async (_ev, id) => {
  const p = shells.get(id);
  if (!p) return null;
  const cwd = await fs.readlink(`/proc/${p.pid}/cwd`).catch(() => null);
  // p.process às vezes vem com o caminho inteiro (/bin/bash): fica só o nome
  const info = { cwd, programa: path.basename(p.process || ''), repo: null, nome: null, branch: null };
  if (cwd) Object.assign(info, await infoDoRepositorio(id, cwd) || {});
  return info;
});

// ---------- Worktree (a branch muda de casa) ----------
// O git não deixa a mesma branch aberta em duas pastas. Pra abrir a branch
// numa worktree, então, a branch muda de casa: a pasta principal do
// repositório volta pra main (ou master), que é onde ela sempre fica, e a
// branch passa a morar numa pasta nova ao lado dela.
ipcMain.handle('git:worktree', async (_ev, cwd) => {
  if (!cwd || !path.isAbsolute(cwd)) return { erro: 'pasta' };

  let repo, origem, branch;
  try {
    const saida = await rodar('git', ['-C', cwd, 'rev-parse', '--path-format=absolute',
      '--git-common-dir', '--show-toplevel', '--abbrev-ref', 'HEAD']);
    const [comum, topo, atual] = saida.trim().split('\n');
    repo = path.dirname(comum);
    origem = topo;
    branch = atual;
  } catch { return { erro: 'fora-de-repo' }; }
  if (!branch || branch === 'HEAD') return { erro: 'sem-branch' };
  // só a pasta principal larga a branch; worktree não vira mãe de outra
  if (origem !== repo) return { erro: 'ja-e-worktree' };
  if (branch === 'main' || branch === 'master') return { erro: 'ja-e-a-principal' };

  // Trocar de branch com arquivo mexido levaria as mudanças junto, caladas.
  const mexido = await rodar('git', ['-C', origem, 'status', '--porcelain']).catch(() => '');
  if (mexido.trim()) return { erro: 'mexido' };

  const destino = await caminhoLivre(path.join(path.dirname(repo),
    `${path.basename(repo)}-${branch.replace(/\//g, '-')}`));

  // A pasta principal precisa largar a branch antes, senão o git recusa.
  const volta = await voltarPraPrincipal(repo);
  if (!volta) return { erro: 'sem-main' };
  try {
    await rodar('git', ['-C', repo, 'worktree', 'add', destino, branch]);
  } catch (erro) {
    console.error('[worktree] não deu:', erro.message);
    await rodar('git', ['-C', repo, 'switch', branch]).catch(() => {});
    return { erro: 'git' };
  }
  console.log('[worktree]', branch, 'agora mora em', destino, '; origem foi pra', volta);
  return { caminho: destino, branch, volta };
});

// bigorna-feat, e se já existir, bigorna-feat-2, bigorna-feat-3…
async function caminhoLivre(caminho) {
  let tentativa = caminho;
  for (let n = 2; await fs.lstat(tentativa).then(() => true, () => false); n++) tentativa = `${caminho}-${n}`;
  return tentativa;
}

// A pasta principal do repositório vive na main (ou na master, nos
// repositórios antigos). Responde pra qual delas foi, ou null se não tem
// nenhuma das duas.
async function voltarPraPrincipal(repo) {
  for (const candidata of ['main', 'master']) {
    if (await rodar('git', ['-C', repo, 'switch', candidata]).then(() => true, () => false)) return candidata;
  }
  return null;
}

// ---------- Arquivos (lateral de pastas e editor) ----------

ipcMain.handle('fs:home', () => os.homedir());
ipcMain.handle('fs:pasta-pedida', () => pastaPedida);
ipcMain.handle('fs:arquivo-pedido', () => arquivoPedido);

// Terminal numa pasta fora da casa: de onde a metade de baixo da lateral começa.
// Pendrive ou outro disco começa na pasta principal dele (onde ele foi montado);
// pasta do próprio sistema, como /etc, começa nela mesma.
ipcMain.handle('fs:raiz-de-fora', async (_ev, pasta) => {
  const dentro = (c, p) => c === p || c.startsWith(p === '/' ? '/' : p + '/');
  let ponto = '/';
  const tabela = await fs.readFile('/proc/self/mountinfo', 'utf8').catch(() => '');
  for (const linha of tabela.split('\n')) {
    const campo = linha.split(' ')[4];
    if (!campo) continue;
    const montagem = campo.replace(/\\([0-7]{3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)));
    if (dentro(pasta, montagem) && montagem.length > ponto.length) ponto = montagem;
  }
  return ponto !== '/' && !dentro(os.homedir(), ponto) ? ponto : pasta;
});

// ---------- arrastar da lateral: o arquivo vai de verdade ----------
// O arrasto nativo do sistema (startDrag) leva o arquivo pra qualquer
// programa — WhatsApp, navegador, Dolphin. O fantasma do arrasto é uma
// folhinha pixelada embutida, porque o startDrag exige um PNG.
const ICONE_DE_ARRASTO = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAWElEQVR42mNgoDd49uzZf2IwRRZwcXHhxRRZQqwFMJqmFpBlCakWkGwJORaQZAkpkUxW6iLGAnwWk2SBlZUVUZhsC2jug6FvwWgcjMbBaBzQ0AJKMN1bKQBZDkgC0Nmn/AAAAABJRU5ErkJggg=='
);
ipcMain.on('fs:arrastar', (ev, caminho) => {
  if (typeof caminho === 'string' && path.isAbsolute(caminho)) {
    ev.sender.startDrag({ file: caminho, icon: ICONE_DE_ARRASTO });
  }
});

// Pastas primeiro, por nome; arquivos por ordem de chegada, o mais novo no
// fim — baixou agora, está no pé da pasta (decisão do Matheus). A chegada é
// a criação do arquivo (birthtime), não a última mexida: editar não muda
// ninguém de lugar, só arquivo novo entra no fim.
ipcMain.handle('fs:list', async (_ev, dir) => {
  const itens = await fs.readdir(dir, { withFileTypes: true });
  const lista = await Promise.all(itens.map(async (d) => ({
    name: d.name,
    isDir: d.isDirectory(),
    chegada: d.isDirectory() ? 0 : await fs.stat(path.join(dir, d.name))
      .then((i) => i.birthtimeMs || i.mtimeMs, () => 0), // sistema de arquivos sem birthtime cai pro mtime
  })));
  return lista.sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1)
      : a.isDir ? a.name.localeCompare(b.name, 'pt-BR')
      : a.chegada - b.chegada || a.name.localeCompare(b.name, 'pt-BR'));
});

// ---------- Ícones da lateral (Material Icon Theme) ----------
// O mesmo tema de ícones do VS Code. O pacote traz o manifesto que o VS Code
// lê: nome de arquivo, extensão e nome de pasta → nome do .svg. A janela pega
// esses mapas uma vez e monta o caminho de cada ícone.

const PASTA_DOS_ICONES = 'node_modules/material-icon-theme/icons';
let temaDeIcones = null;

ipcMain.handle('icones:tema', async () => {
  if (temaDeIcones) return temaDeIcones;
  const manifesto = JSON.parse(
    await fs.readFile(path.join(__dirname, 'node_modules/material-icon-theme/dist/material-icons.json'), 'utf8')
  );
  // O manifesto aponta pra um apelido do ícone, e alguns apelidos moram num
  // arquivo de nome diferente (os ".clone.svg"), então aqui cada mapa já sai
  // com o nome do arquivo que existe no disco.
  const arquivoDoIcone = (apelido) => path.basename(manifesto.iconDefinitions[apelido].iconPath);
  const resolver = (mapa) => Object.fromEntries(Object.entries(mapa).map(([k, v]) => [k, arquivoDoIcone(v)]));
  temaDeIcones = {
    pasta: PASTA_DOS_ICONES,
    porNome: resolver(manifesto.fileNames),
    porExtensao: resolver(manifesto.fileExtensions),
    pastaPorNome: resolver(manifesto.folderNames),
    pastaAbertaPorNome: resolver(manifesto.folderNamesExpanded),
    padrao: {
      arquivo: arquivoDoIcone(manifesto.file),
      pasta: arquivoDoIcone(manifesto.folder),
      pastaAberta: arquivoDoIcone(manifesto.folderExpanded),
    },
  };
  return temaDeIcones;
});

// ---------- Vigia das pastas: a lateral se atualiza sozinha ----------
// Um vigia do sistema (inotify) por pasta aberta na lateral. Mudou qualquer
// coisa dentro dela — criou, apagou, renomeou, mesmo por fora da Bigorna —
// a janela é avisada e relê a pasta. A espera curta junta uma rajada de
// mudanças num aviso só.
const vigias = new Map(); // pasta → { vigia, espera }

ipcMain.handle('fs:watch', (_ev, dir) => {
  // Vigia vivo fica: recriar a cada releitura abria um vão sem ninguém
  // olhando, e evento que caísse nele se perdia. Vigia que deu erro já saiu
  // do mapa, então o pedido seguinte cria um novo no lugar.
  if (vigias.has(dir)) return true;
  try {
    const v = vigiar(dir, () => {
      const dados = vigias.get(dir);
      if (!dados) return;
      clearTimeout(dados.espera);
      dados.espera = setTimeout(() => {
        if (win) win.webContents.send('fs:mudou', dir);
      }, 300);
    });
    v.on('error', () => { // a pasta sumiu: o vigia morre junto
      clearTimeout(vigias.get(dir)?.espera);
      vigias.delete(dir);
    });
    vigias.set(dir, { vigia: v, espera: null });
  } catch { /* sem permissão ou pasta já era: segue sem vigia */ }
  return true;
});

// A pasta saiu da lateral: o vigia dela vai junto, senão eles só acumulam.
ipcMain.on('fs:unwatch', (_ev, dir) => {
  const dados = vigias.get(dir);
  if (!dados) return;
  clearTimeout(dados.espera);
  dados.vigia.close();
  vigias.delete(dir);
});

ipcMain.handle('fs:read', async (_ev, arquivo) => {
  const info = await fs.stat(arquivo);
  if (info.size > 2 * 1024 * 1024) return { erro: 'grande' };
  const buf = await fs.readFile(arquivo);
  if (buf.includes(0)) return { erro: 'binario' }; // tem byte nulo: não é texto
  return { conteudo: buf.toString('utf8'), mtime: info.mtimeMs };
});

// Gravação em dois tempos (arquivo ao lado + troca): queda no meio do caminho
// não deixa o arquivo pela metade. E se alguém (git, Claude no terminal) mexeu
// nele depois do mtime que a janela conhece, não grava por cima calado:
// responde que mudou e a janela decide.
ipcMain.handle('fs:write', async (_ev, arquivo, conteudo, mtimeConhecido) => {
  const antes = await fs.stat(arquivo).catch(() => null);
  if (mtimeConhecido != null && antes && antes.mtimeMs > mtimeConhecido) return { erro: 'mudou-por-fora' };
  const aoLado = path.join(path.dirname(arquivo), '.' + path.basename(arquivo) + '.bigorna~');
  await fs.writeFile(aoLado, conteudo, { encoding: 'utf8', mode: antes ? antes.mode & 0o777 : 0o644 });
  await fs.rename(aoLado, arquivo);
  return { mtime: (await fs.stat(arquivo).catch(() => null))?.mtimeMs ?? null };
});

// ---------- Menu do botão direito na lateral (igual ao do Dolphin) ----------

// Trava de segurança das opções que mexem no arquivo: nunca a raiz nem a
// pasta pessoal inteira, e só caminho completo.
function podeMexer(caminho) {
  return typeof caminho === 'string' && path.isAbsolute(caminho)
    && path.normalize(caminho) === caminho
    && caminho !== '/' && caminho !== os.homedir();
}

function rodar(programa, args, opcoes = {}) {
  return new Promise((resolve, reject) => {
    execFile(programa, args, opcoes, (erro, saida) => (erro ? reject(erro) : resolve(saida)));
  });
}

// O gio responde em português; em inglês o texto dele é fácil de ler aqui.
const EM_INGLES = { env: { ...process.env, LC_ALL: 'C' } };

// Abre um programa solto: ele continua aberto mesmo se a Bigorna fechar.
function soltar(programa, args) {
  spawn(programa, args, { detached: true, stdio: 'ignore' }).unref();
}

async function tipoDoArquivo(caminho) {
  const saida = await rodar('gio', ['info', '-a', 'standard::content-type', caminho], EM_INGLES).catch(() => '');
  const achou = saida.match(/standard::content-type: (\S+)/);
  return achou ? achou[1] : 'application/octet-stream';
}

// Onde o sistema guarda programas (.desktop) e ícones.
const pastasDeDados = [
  path.join(os.homedir(), '.local/share'),
  ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':'),
];

// Acha o ícone pelo nome, na mesma ordem do Dolphin com tema escuro: Breeze
// escuro, Breeze e depois os ícones próprios dos programas. Devolve pronto pra
// virar <img> na janela, ou null se não achou.
const iconesAchados = new Map();
async function icone(nome) {
  if (!nome) return null;
  if (iconesAchados.has(nome)) return iconesAchados.get(nome);
  const tentativas = [];
  if (path.isAbsolute(nome)) tentativas.push(nome);
  for (const base of pastasDeDados.map((p) => path.join(p, 'icons'))) {
    for (const tema of ['breeze-dark', 'breeze']) {
      for (const tipo of ['actions', 'places', 'devices', 'apps', 'mimetypes']) {
        for (const tam of ['16', '22', '24', '32', '48']) tentativas.push(path.join(base, tema, tipo, tam, nome + '.svg'));
      }
    }
    for (const tam of ['scalable', '16x16', '22x22', '24x24', '32x32', '48x48', '64x64', '128x128', '256x256']) {
      tentativas.push(path.join(base, 'hicolor', tam, 'apps', nome + '.svg'));
      tentativas.push(path.join(base, 'hicolor', tam, 'apps', nome + '.png'));
    }
  }
  tentativas.push(`/usr/share/pixmaps/${nome}.svg`, `/usr/share/pixmaps/${nome}.png`);

  let achado = null;
  for (const arquivo of tentativas) {
    const dados = await fs.readFile(arquivo).catch(() => null);
    if (!dados) continue;
    const tipo = arquivo.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    achado = `data:${tipo};base64,${dados.toString('base64')}`;
    break;
  }
  iconesAchados.set(nome, achado);
  return achado;
}

// Programas que o sistema conhece pra esse tipo, o padrão primeiro: a mesma
// lista do "Abrir com" do Dolphin.
async function programasPara(tipo) {
  const saida = await rodar('gio', ['mime', tipo], EM_INGLES).catch(() => '');
  const ids = [];
  const padrao = saida.match(/^Default application for .*: (\S+)$/m);
  if (padrao) ids.push(padrao[1]);
  const registrados = saida.split('Registered applications:')[1] || '';
  for (const linha of registrados.split('Recommended applications:')[0].split('\n')) {
    if (linha.trim() && !ids.includes(linha.trim())) ids.push(linha.trim());
  }

  const programas = [];
  for (const id of ids) {
    for (const pasta of pastasDeDados) {
      const arquivo = path.join(pasta, 'applications', id);
      const texto = await fs.readFile(arquivo, 'utf8').catch(() => null);
      if (!texto) continue;
      const entrada = texto.split(/^\[/m).find((s) => s.startsWith('Desktop Entry]')) || '';
      const nome = (entrada.match(/^Name\[pt_BR\]=(.+)$/m) || entrada.match(/^Name=(.+)$/m) || [])[1];
      const nomeDoIcone = (entrada.match(/^Icon=(.+)$/m) || [])[1];
      if (nome && !programas.some((p) => p.nome === nome)) {
        programas.push({ nome, arquivo, icone: await icone(nomeDoIcone) });
      }
      break;
    }
  }
  return programas;
}

// Os mesmos tipos da ação "Transcrever áudio" do Dolphin
// (~/.local/share/kio/servicemenus/transcrever.desktop).
const ehAudio = (tipo) => tipo.startsWith('audio/') || tipo === 'application/ogg' || tipo === 'video/ogg';

// Ícones das opções do menu: os mesmos que o Dolphin usa.
const ICONES_DO_MENU = {
  abrirCom: 'document-open',
  criarNovo: 'list-add',
  pasta: 'folder-new',
  arquivo: 'document-new',
  renomear: 'edit-rename',
  lixeira: 'user-trash',
  excluir: 'edit-delete',
  compactar: 'archive-insert',
  transcrever: 'audio-input-microphone', // o mesmo do transcrever.desktop
  propriedades: 'document-properties',
};

// O menu é desenhado pela janela (renderer.js); daqui sai só o que depende do
// sistema: os programas do "Abrir com", se é áudio e os ícones.
ipcMain.handle('menu:opcoes', async (_ev, caminho, ehPasta) => {
  const tipo = await tipoDoArquivo(caminho);
  const icones = {};
  for (const [chave, nome] of Object.entries(ICONES_DO_MENU)) icones[chave] = await icone(nome);
  return {
    programas: await programasPara(tipo),
    audio: !ehPasta && ehAudio(tipo),
    icones,
  };
});

// Ícones do menu do botão direito na aba do terminal.
const ICONES_DA_ABA = {
  worktree: 'folder-new',
  renomear: 'edit-rename',
  fechar: 'tab-close',
  lado: 'view-split-left-right',
  embaixo: 'view-split-top-bottom',
  zoom: 'view-fullscreen',
  esquerda: 'go-previous',
  direita: 'go-next',
};

ipcMain.handle('menu:icones-da-aba', async () => {
  const icones = {};
  for (const [chave, nome] of Object.entries(ICONES_DA_ABA)) icones[chave] = await icone(nome);
  return icones;
});

ipcMain.on('acao:abrir-com', (_ev, programa, caminho) => {
  if (programa.endsWith('.desktop') && path.isAbsolute(caminho)) soltar('gio', ['launch', programa, caminho]);
});

ipcMain.on('acao:transcrever', (_ev, caminho) => {
  if (path.isAbsolute(caminho)) soltar(path.join(os.homedir(), '.local/bin/transcrever'), ['--janela', caminho]);
});

ipcMain.on('acao:propriedades', (_ev, caminho) => {
  if (path.isAbsolute(caminho)) soltar('kioclient', ['openProperties', caminho]);
});

ipcMain.handle('fs:rename', async (_ev, de, para) => {
  if (!podeMexer(de) || !podeMexer(para) || path.dirname(de) !== path.dirname(para)) return { erro: 'caminho' };
  // rename por cima de um que já existe apagaria o outro sem avisar
  if (await fs.lstat(para).then(() => true, () => false)) return { erro: 'existe' };
  await fs.rename(de, para);
  return { ok: true };
});

ipcMain.handle('fs:create', async (_ev, caminho, ehPasta) => {
  if (!podeMexer(caminho)) return { erro: 'caminho' };
  try {
    if (ehPasta) await fs.mkdir(caminho);
    else await fs.writeFile(caminho, '', { flag: 'wx' }); // "wx": falha se já existe
    return { ok: true };
  } catch (erro) {
    return { erro: erro.code === 'EEXIST' ? 'existe' : 'falhou' };
  }
});

ipcMain.handle('fs:trash', async (_ev, caminho) => {
  if (!podeMexer(caminho)) return { erro: 'caminho' };
  await sistema.trashItem(caminho);
  return { ok: true };
});

ipcMain.handle('fs:delete', async (ev, caminho) => {
  if (!podeMexer(caminho)) return { erro: 'caminho' };
  const ehPasta = (await fs.lstat(caminho)).isDirectory();
  const { response } = await dialog.showMessageBox(BrowserWindow.fromWebContents(ev.sender), {
    type: 'warning',
    title: 'Excluir de vez',
    message: `Excluir "${path.basename(caminho)}" de vez?`,
    detail: ehPasta
      ? 'A pasta e tudo o que tem dentro dela somem, sem passar pela lixeira. Não dá pra recuperar.'
      : 'O arquivo some sem passar pela lixeira. Não dá pra recuperar.',
    buttons: ['Excluir', 'Cancelar'],
    defaultId: 1, // Enter sem querer cancela
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { cancelado: true };
  await fs.rm(caminho, { recursive: true });
  return { ok: true };
});

// Cria o .zip ao lado: pasta "fotos" vira "fotos.zip", arquivo "nota.txt" vira
// "nota.zip". Se o nome já existe, vira "fotos (2).zip".
ipcMain.handle('fs:zip', async (_ev, caminho) => {
  if (!podeMexer(caminho)) return { erro: 'caminho' };
  const pasta = path.dirname(caminho);
  const nome = path.basename(caminho);
  const ehPasta = (await fs.lstat(caminho)).isDirectory();
  const base = ehPasta || nome.lastIndexOf('.') <= 0 ? nome : nome.slice(0, nome.lastIndexOf('.'));
  let zip = base + '.zip';
  for (let n = 2; await fs.lstat(path.join(pasta, zip)).then(() => true, () => false); n++) {
    zip = `${base} (${n}).zip`;
  }
  // -y guarda atalho (link) como atalho, sem copiar o que ele aponta; o "./"
  // impede que um nome começando com "-" seja lido como opção do zip
  await rodar('zip', ['-r', '-q', '-y', './' + zip, './' + nome], { cwd: pasta, maxBuffer: 16 * 1024 * 1024 });
  return { ok: true, zip: path.join(pasta, zip) };
});

// ---------- Jogos: o emulador roda dentro da própria janela ----------
// Cada console tem seu emulador em WebAssembly (o "core"). A Bigorna baixa o
// core uma vez e guarda na pasta de configuração dela; da segunda vez em
// diante o jogo abre sem internet. Vem do mesmo lugar de onde a biblioteca
// nostalgist pegaria sozinha — guardar aqui é o que deixa jogar off-line.

const ENDERECO_DOS_CORES =
  'https://cdn.jsdelivr.net/gh/arianrhodsandlot/retroarch-emscripten-build@v1.22.2/retroarch';

ipcMain.handle('jogo:core', async (_ev, core) => {
  if (!/^[a-z0-9_]+$/.test(core)) return { erro: 'nome' }; // o nome vem da tela: nada de caminho
  const pasta = path.join(app.getPath('userData'), 'cores');
  const js = path.join(pasta, `${core}_libretro.js`);
  const wasm = path.join(pasta, `${core}_libretro.wasm`);
  const jaTem = await Promise.all([js, wasm].map((f) => fs.stat(f).then(() => true, () => false)));

  if (!jaTem.every(Boolean)) {
    try {
      await fs.mkdir(pasta, { recursive: true });
      const resposta = await net.fetch(`${ENDERECO_DOS_CORES}/${core}_libretro.zip`);
      if (!resposta.ok) throw new Error(resposta.status);
      const zip = path.join(pasta, `${core}.zip`);
      await fs.writeFile(zip, Buffer.from(await resposta.arrayBuffer()));
      await rodar('unzip', ['-o', '-q', zip, '-d', pasta]);
      await fs.rm(zip, { force: true });
    } catch {
      return { erro: 'baixar' };
    }
  }
  return { js: await fs.readFile(js), wasm: await fs.readFile(wasm) };
});

// O arquivo do jogo é binário: o fs:read do editor recusaria. Aqui ele vai cru.
ipcMain.handle('fs:bytes', async (_ev, arquivo) => {
  const info = await fs.stat(arquivo).catch(() => null);
  if (!info) return { erro: 'sumiu' };
  if (info.size > 64 * 1024 * 1024) return { erro: 'grande' };
  return { bytes: await fs.readFile(arquivo) };
});

// O ponto de onde o jogo continua. Fica guardado pelo nome do arquivo, na
// pasta de configuração — sair e voltar amanhã cai no mesmo lugar.
function arquivoDoPonto(jogo) {
  const nome = path.basename(jogo).replace(/[^\p{L}\p{N} ._-]/gu, '_');
  return path.join(app.getPath('userData'), 'pontos', nome + '.ponto');
}

ipcMain.handle('jogo:guardar-ponto', async (_ev, jogo, bytes) => {
  const arquivo = arquivoDoPonto(jogo);
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.writeFile(arquivo, Buffer.from(bytes));
  return { ok: true };
});

ipcMain.handle('jogo:ler-ponto', async (_ev, jogo) => {
  const bytes = await fs.readFile(arquivoDoPonto(jogo)).catch(() => null);
  return bytes ? { bytes } : { erro: 'sem ponto' };
});

app.whenReady().then(async () => {
  if (arquivoPedido && !pedido.comando && await entregarPraJanelaAberta(arquivoPedido)) return app.exit(0);
  criarJanela();
}).catch((erro) => anotarErro('partida', erro));

app.on('window-all-closed', () => app.quit());
