# Bigorna

Terminal com janela própria que substitui o Konsole no dia a dia do Matheus Gustav. Numa tela só: lateral de pastas, editor e terminais em abas — feito antes de tudo pro **Claude Code rodar bem** dentro dele — e com um console embutido pra enquanto a IA trabalha.

Este arquivo é um retrato do presente: mudou algo, troca-se a linha. Histórico é papel do git.

## Stack

- **Electron** (janela), **xterm.js + node-pty** (terminais, desenho por WebGL), **Monaco** (editor), **nostalgist** (emulador).
- Sem framework: HTML, CSS e JS puros. `main.js` (processo principal), `preload.js` (ponte), `renderer.js` (tela).
- Visual escuro, quadrado, estilo pixelado assumido. Ícones em SVG, nada de emoji.
- **Ícones da lateral**: os do **Material Icon Theme**, o mesmo tema do VS Code — coloridos, um desenho por tipo de arquivo e por nome de pasta (`src`, `node_modules`, `.git`…), com variante de pasta aberta. Vêm do pacote npm `material-icon-theme` (MIT); o manifesto dele é lido uma vez no processo principal e a janela monta o caminho de cada `.svg`.

## Como a Bigorna se comporta hoje

- **Salvar automático**: toda mudança no editor grava sozinha (0,4s depois da última tecla). Não existe botão salvar nem estado "não salvo"; desfazer é apagar. Ctrl+S força a gravação na hora.
- **Clicar de novo** no arquivo aberto na lateral fecha ele.
- **Visor**: imagem, áudio, vídeo e PDF abrem dentro da janela (só ver/tocar, não editar).
- **Fliperama**: clicar no fliperama do trilho, ou num arquivo de jogo (`.sfc`, `.smc`, `.nes`, `.gb`, `.gbc`, `.gba`, `.gen`, `.sms`, `.gg`, `.a26`), liga o console dentro da área dos terminais, sempre pela direita e com uma aba própria na barra da coluna. Sem terminal na coluna da direita ele toma a coluna inteira, em pé: prateleira (os jogos de `~/Jogos`) em cima, a tela no meio e os atalhos no pé. Com terminal ali, entra na metade de baixo, deitado: tela à esquerda, prateleira e atalhos à direita — a divisa entre o terminal e o jogo se arrasta, e fechar o último terminal da coluna devolve ela inteira pro jogo. Editor e visor não participam: arquivo aberto e partida convivem, cada um na sua área. **Sair salva o ponto antes** (× da aba, ctrl+q ou clicar de novo no arquivo), e abrir o mesmo jogo de novo continua dali — o ponto fica em `~/.config/bigorna/pontos`, um por jogo; "recomeçar" é quem volta pro início. Trocar de jogo também salva o de antes. O emulador de cada console (`nostalgist` + cores do RetroArch) é baixado uma vez e guardado em `~/.config/bigorna/cores`; depois disso roda sem internet. O teclado vai pro jogo quando a tela dele está em foco — ela já nasce em foco.
- **Abas de terminal** agrupadas por repositório git: a Bigorna pergunta a cada 3s a pasta de cada terminal; worktrees caem no mesmo grupo. ✳ na aba = Claude rodando ali. Aba de repositório mostra a branch.
- **Colunas**: a área do terminal se divide em colunas lado a lado, sem limite de quantidade (quem limita é a largura do monitor; cada coluna tem no mínimo 120px e a divisa entre elas se arrasta). Cada coluna tem a própria barra de abas — mesmos grupos e cores — e o próprio `+`; clicar numa aba troca só o terminal daquela coluna. A coluna sem o foco do teclado mostra a aba ativa um tom mais apagada. Fechar o último terminal de uma coluna fecha a coluna; a última que sobra fica.
- **Arrastar a aba**: solta na barra de qualquer coluna, entra ali (serve pra reordenar e pra mudar de coluna); solta no meio de um terminal, vai pra coluna dele; solta na beirada esquerda ou direita de um terminal, vira uma coluna nova naquele lado. Uma sombra mostra onde vai cair. Durante o arrasto as abas não se redesenham, e soltar fora de alvo não muda nada.
- **Arrastar a coluna**: pegar na parte vazia (cinza) da barra de abas arrasta a coluna inteira; soltar em cima de outra coluna troca as duas de lugar, cada uma levando a largura que tinha. Em cima de si mesma, nada acontece.
- **Botão direito na aba**: mostrar ao lado (a aba vira uma coluna nova), mover pra coluna da esquerda/direita, abrir worktree da branch, renomear a aba (apagar o nome devolve o automático) e fechar o terminal.
- **Abrir worktree**: o git não deixa a mesma branch em duas pastas, então a branch muda de casa — a pasta principal volta pra main (ou master), onde ela sempre fica, a branch passa a morar em `<repo>-<branch>` ao lado dela e um terminal novo já abre lá, no mesmo grupo de abas. Só a pasta principal faz isso: na main/master o item fica apagado, e numa aba de worktree ele avisa. Com arquivo mexido sem commit, não faz nada e avisa na barra de cima.
- **Teclas capturadas (nada além disso; o resto vai inteiro pro bash)**: Ctrl+J esconde/mostra o terminal, Ctrl+Shift+C/V copia/cola no terminal, Ctrl+S só com o editor em foco.
- Botão direito na lateral: menu no estilo do Dolphin (abrir com, renomear, lixeira, zip, transcrever áudio…).

## Avisos

- Não abre por SSH — servidor remoto continua no terminal comum.
- Licença **PolyForm Noncommercial 1.0.0** (`LICENSE.md`); repositório público em MatheusGustav/bigorna.
- Rodar: `npm start`. Sem suíte de testes; conferir é abrir e usar.

## Memórias do projeto

> Anotações que o Matheus pedir pra guardar entram aqui.
