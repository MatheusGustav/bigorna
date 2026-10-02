const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // terminal
  ptySpawn: (cols, rows) => ipcRenderer.invoke('pty:spawn', cols, rows),
  ptyWrite: (data) => ipcRenderer.send('pty:write', data),
  ptyResize: (cols, rows) => ipcRenderer.send('pty:resize', cols, rows),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_ev, data) => cb(data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_ev, codigo) => cb(codigo)),

  // arquivos
  home: () => ipcRenderer.invoke('fs:home'),
  listDir: (dir) => ipcRenderer.invoke('fs:list', dir),
  readFile: (arquivo) => ipcRenderer.invoke('fs:read', arquivo),
  writeFile: (arquivo, conteudo) => ipcRenderer.invoke('fs:write', arquivo, conteudo),
  renomear: (de, para) => ipcRenderer.invoke('fs:rename', de, para),
  criar: (caminho, ehPasta) => ipcRenderer.invoke('fs:create', caminho, ehPasta),
  lixeira: (caminho) => ipcRenderer.invoke('fs:trash', caminho),
  excluir: (caminho) => ipcRenderer.invoke('fs:delete', caminho),
  compactar: (caminho) => ipcRenderer.invoke('fs:zip', caminho),

  // menu do botão direito na lateral
  opcoesDoMenu: (caminho, ehPasta) => ipcRenderer.invoke('menu:opcoes', caminho, ehPasta),
  abrirCom: (programa, caminho) => ipcRenderer.send('acao:abrir-com', programa, caminho),
  transcrever: (caminho) => ipcRenderer.send('acao:transcrever', caminho),
  propriedades: (caminho) => ipcRenderer.send('acao:propriedades', caminho),

  // área de transferência (pro Ctrl+Shift+C/V do terminal, igual ao Konsole)
  copiar: (texto) => clipboard.writeText(texto),
  colar: () => clipboard.readText(),
});
