const { contextBridge, ipcRenderer, clipboard, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // terminais (um por aba; o id vem da janela)
  ptySpawn: (id, cols, rows, pasta) => ipcRenderer.invoke('pty:spawn', id, cols, rows, pasta),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  ptyInfo: (id) => ipcRenderer.invoke('pty:info', id),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_ev, id, data) => cb(id, data)),
  abrirLink: (url) => ipcRenderer.send('acao:abrir-link', url),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_ev, id, codigo) => cb(id, codigo)),

  // worktree a partir da aba do terminal
  abrirWorktree: (cwd) => ipcRenderer.invoke('git:worktree', cwd),
  iconesDaAba: () => ipcRenderer.invoke('menu:icones-da-aba'),

  // arquivos
  home: () => ipcRenderer.invoke('fs:home'),
  pastaPedida: () => ipcRenderer.invoke('fs:pasta-pedida'),
  arquivoPedido: () => ipcRenderer.invoke('fs:arquivo-pedido'),
  onAbrirArquivo: (cb) => ipcRenderer.on('abrir-arquivo', (_ev, caminho) => cb(caminho)),
  raizDeFora: (pasta) => ipcRenderer.invoke('fs:raiz-de-fora', pasta),
  temaDeIcones: () => ipcRenderer.invoke('icones:tema'),
  listDir: (dir) => ipcRenderer.invoke('fs:list', dir),
  readFile: (arquivo) => ipcRenderer.invoke('fs:read', arquivo),
  writeFile: (arquivo, conteudo, mtimeConhecido) => ipcRenderer.invoke('fs:write', arquivo, conteudo, mtimeConhecido),
  vigiarPasta: (dir) => ipcRenderer.invoke('fs:watch', dir),
  desvigiarPasta: (dir) => ipcRenderer.send('fs:unwatch', dir),
  onPastaMudou: (cb) => ipcRenderer.on('fs:mudou', (_ev, dir) => cb(dir)),

  // fechar a janela espera a última gravação do editor
  onVaiFechar: (cb) => ipcRenderer.on('janela:vai-fechar', cb),
  podeFechar: () => ipcRenderer.send('janela:pode-fechar'),
  // arrastar da lateral: o sistema leva o arquivo de verdade; e o caminho de
  // um File solto na janela (só o preload enxerga ele)
  arrastarArquivo: (caminho) => ipcRenderer.send('fs:arrastar', caminho),
  caminhoDoArquivo: (arquivo) => webUtils.getPathForFile(arquivo),

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
  // async de propósito: a tela faz .then() — sem a promessa, o Ctrl+Shift+V
  // quebrava com "erro interno" e não colava nada
  colar: async () => clipboard.readText(),
});
