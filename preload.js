const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // terminais (um por aba; o id vem da janela)
  ptySpawn: (id, cols, rows, pasta) => ipcRenderer.invoke('pty:spawn', id, cols, rows, pasta),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  ptyInfo: (id) => ipcRenderer.invoke('pty:info', id),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_ev, id, data) => cb(id, data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_ev, id, codigo) => cb(id, codigo)),

  // worktree a partir da aba do terminal
  abrirWorktree: (cwd) => ipcRenderer.invoke('git:worktree', cwd),
  iconesDaAba: () => ipcRenderer.invoke('menu:icones-da-aba'),

  // arquivos
  home: () => ipcRenderer.invoke('fs:home'),
  temaDeIcones: () => ipcRenderer.invoke('icones:tema'),
  listDir: (dir) => ipcRenderer.invoke('fs:list', dir),
  readFile: (arquivo) => ipcRenderer.invoke('fs:read', arquivo),
  writeFile: (arquivo, conteudo) => ipcRenderer.invoke('fs:write', arquivo, conteudo),
  vigiarPasta: (dir) => ipcRenderer.invoke('fs:watch', dir),
  onPastaMudou: (cb) => ipcRenderer.on('fs:mudou', (_ev, dir) => cb(dir)),
  renomear: (de, para) => ipcRenderer.invoke('fs:rename', de, para),
  criar: (caminho, ehPasta) => ipcRenderer.invoke('fs:create', caminho, ehPasta),
  lixeira: (caminho) => ipcRenderer.invoke('fs:trash', caminho),
  excluir: (caminho) => ipcRenderer.invoke('fs:delete', caminho),
  compactar: (caminho) => ipcRenderer.invoke('fs:zip', caminho),

  // jogos
  coreDoJogo: (core) => ipcRenderer.invoke('jogo:core', core),
  lerBytes: (arquivo) => ipcRenderer.invoke('fs:bytes', arquivo),
  guardarPonto: (jogo, bytes) => ipcRenderer.invoke('jogo:guardar-ponto', jogo, bytes),
  lerPonto: (jogo) => ipcRenderer.invoke('jogo:ler-ponto', jogo),

  // menu do botão direito na lateral
  opcoesDoMenu: (caminho, ehPasta) => ipcRenderer.invoke('menu:opcoes', caminho, ehPasta),
  abrirCom: (programa, caminho) => ipcRenderer.send('acao:abrir-com', programa, caminho),
  transcrever: (caminho) => ipcRenderer.send('acao:transcrever', caminho),
  propriedades: (caminho) => ipcRenderer.send('acao:propriedades', caminho),

  // área de transferência (pro Ctrl+Shift+C/V do terminal, igual ao Konsole)
  copiar: (texto) => clipboard.writeText(texto),
  colar: () => clipboard.readText(),
});
