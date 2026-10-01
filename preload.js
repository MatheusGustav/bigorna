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

  // área de transferência (pro Ctrl+Shift+C/V do terminal, igual ao Konsole)
  copiar: (texto) => clipboard.writeText(texto),
  colar: () => clipboard.readText(),
});
