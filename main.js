const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const pty = require('node-pty');

let win = null;
let shell = null;

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
    },
  });

  // Sem menu: nenhum atalho do Electron captura tecla (Ctrl+W, Ctrl+R etc.).
  Menu.setApplicationMenu(null);

  win.loadFile('index.html');

  win.on('closed', () => {
    win = null;
    if (shell) {
      shell.kill();
      shell = null;
    }
  });
}

// ---------- Terminal (pty = o "fio" que liga a tela ao bash de verdade) ----------

ipcMain.handle('pty:spawn', (_ev, cols, rows) => {
  if (shell) {
    shell.kill();
    shell = null;
  }
  const programa = process.env.SHELL || '/bin/bash';
  shell = pty.spawn(programa, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: os.homedir(),
    env: process.env,
  });
  console.log('[pty] aberto: pid', shell.pid, 'tamanho', cols, 'x', rows);
  shell.onData((data) => {
    if (win) win.webContents.send('pty:data', data);
  });
  shell.onExit(({ exitCode, signal }) => {
    console.log('[pty] encerrou: código', exitCode, 'sinal', signal);
    shell = null;
    if (win) win.webContents.send('pty:exit', exitCode);
  });
  return true;
});

ipcMain.on('pty:write', (_ev, data) => {
  if (shell) shell.write(data);
});

ipcMain.on('pty:resize', (_ev, cols, rows) => {
  if (shell && cols > 0 && rows > 0) shell.resize(cols, rows);
});

// ---------- Arquivos (lateral de pastas e editor) ----------

ipcMain.handle('fs:home', () => os.homedir());

ipcMain.handle('fs:list', async (_ev, dir) => {
  const itens = await fs.readdir(dir, { withFileTypes: true });
  return itens
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'pt-BR') : a.isDir ? -1 : 1));
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

app.whenReady().then(criarJanela);

app.on('window-all-closed', () => app.quit());
