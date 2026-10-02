# Bigorna

Terminal com janela própria que substitui o Konsole no dia a dia do Matheus Gustav. Numa tela só: lateral de pastas, editor e terminais em abas — feito antes de tudo pro **Claude Code rodar bem** dentro dele. Jogos pra enquanto a IA trabalha ficam pra depois.

Este arquivo é um retrato do presente: mudou algo, troca-se a linha. Histórico é papel do git.

## Stack

- **Electron** (janela), **xterm.js + node-pty** (terminais, desenho por WebGL), **Monaco** (editor).
- Sem framework: HTML, CSS e JS puros. `main.js` (processo principal), `preload.js` (ponte), `renderer.js` (tela).
- Visual preto e branco, quadrado, estilo pixelado assumido. Ícones em SVG, nada de emoji.

## Como a Bigorna se comporta hoje

- **Salvar automático**: toda mudança no editor grava sozinha (0,4s depois da última tecla). Não existe botão salvar nem estado "não salvo"; desfazer é apagar. Ctrl+S força a gravação na hora.
- **Clicar de novo** no arquivo aberto na lateral fecha ele.
- **Visor**: imagem, áudio, vídeo e PDF abrem dentro da janela (só ver/tocar, não editar).
- **Abas de terminal** agrupadas por repositório git: a Bigorna pergunta a cada 3s a pasta de cada terminal; worktrees caem no mesmo grupo. ✳ na aba = Claude rodando ali. Aba de repositório mostra a branch.
- **Teclas capturadas (nada além disso; o resto vai inteiro pro bash)**: Ctrl+J esconde/mostra o terminal, Ctrl+Shift+C/V copia/cola no terminal, Ctrl+S só com o editor em foco.
- Botão direito na lateral: menu no estilo do Dolphin (abrir com, renomear, lixeira, zip, transcrever áudio…).

## Avisos

- Não abre por SSH — servidor remoto continua no terminal comum.
- Licença **PolyForm Noncommercial 1.0.0** (`LICENSE.md`); repositório público em MatheusGustav/bigorna.
- Rodar: `npm start`. Sem suíte de testes; conferir é abrir e usar.

## Memórias do projeto

> Anotações que o Matheus pedir pra guardar entram aqui.
