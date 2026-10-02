const { app, BrowserWindow, Menu, ipcMain, dialog, net, shell: sistema } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { watch: vigiar } = require('fs');
const { execFile, spawn } = require('child_process');
const pty = require('node-pty');

let win = null;
const shells = new Map(); // id do terminal (dado pela janela) → pty

function criarJanela() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    backgroundColor: '#0c0c0c',
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

  win.on('closed', () => {
    win = null;
    for (const p of shells.values()) p.kill();
    shells.clear();
  });
}

// ---------- Terminal (pty = o "fio" que liga a tela ao bash de verdade) ----------

ipcMain.handle('pty:spawn', async (_ev, id, cols, rows, pasta) => {
  const programa = process.env.SHELL || '/bin/bash';
  const dentroDe = pasta && path.isAbsolute(pasta)
    && await fs.stat(pasta).then((e) => e.isDirectory(), () => false);
  const p = pty.spawn(programa, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: dentroDe ? pasta : os.homedir(),
    env: process.env,
  });
  shells.set(id, p);
  console.log('[pty] terminal', id, 'aberto: pid', p.pid, 'tamanho', cols, 'x', rows);
  p.onData((data) => {
    if (win) win.webContents.send('pty:data', id, data);
  });
  p.onExit(({ exitCode, signal }) => {
    console.log('[pty] terminal', id, 'encerrou: código', exitCode, 'sinal', signal);
    shells.delete(id);
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
ipcMain.handle('pty:info', async (_ev, id) => {
  const p = shells.get(id);
  if (!p) return null;
  const cwd = await fs.readlink(`/proc/${p.pid}/cwd`).catch(() => null);
  // p.process às vezes vem com o caminho inteiro (/bin/bash): fica só o nome
  const info = { cwd, programa: path.basename(p.process || ''), repo: null, nome: null, branch: null };
  if (cwd) {
    try {
      const saida = await rodar('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--abbrev-ref', 'HEAD']);
      const [comum, branch] = saida.trim().split('\n');
      info.repo = path.dirname(comum);
      info.nome = path.basename(info.repo);
      info.branch = branch;
    } catch { /* fora de repositório: fica só a pasta */ }
  }
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

ipcMain.handle('fs:list', async (_ev, dir) => {
  const itens = await fs.readdir(dir, { withFileTypes: true });
  return itens
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'pt-BR') : a.isDir ? -1 : 1));
});

// ---------- Vigia das pastas: a lateral se atualiza sozinha ----------
// Um vigia do sistema (inotify) por pasta aberta na lateral. Mudou qualquer
// coisa dentro dela — criou, apagou, renomeou, mesmo por fora da Bigorna —
// a janela é avisada e relê a pasta. A espera curta junta uma rajada de
// mudanças num aviso só.
const vigias = new Map(); // pasta → { vigia, espera }

ipcMain.handle('fs:watch', (_ev, dir) => {
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

ipcMain.handle('fs:read', async (_ev, arquivo) => {
  const info = await fs.stat(arquivo);
  if (info.size > 2 * 1024 * 1024) return { erro: 'grande' };
  const buf = await fs.readFile(arquivo);
  if (buf.includes(0)) return { erro: 'binario' }; // tem byte nulo: não é texto
  return { conteudo: buf.toString('utf8') };
});

ipcMain.handle('fs:write', async (_ev, arquivo, conteudo) => {
  await fs.writeFile(arquivo, conteudo, 'utf8');
  return true;
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
const ICONES_DA_ABA = { worktree: 'folder-new', renomear: 'edit-rename', fechar: 'tab-close' };

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

app.whenReady().then(criarJanela);

app.on('window-all-closed', () => app.quit());
