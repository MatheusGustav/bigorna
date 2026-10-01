# Meu Terminal — decisões alinhadas

> Conversa de alinhamento com o Claude em 01/10/2026. Nada construído ainda; este arquivo guarda só o que foi decidido.

## O que é o projeto

Um programa com janela própria que **substitui o Konsole** no dia a dia. Ele é o próprio terminal, não um programa que roda dentro de outro terminal. Numa tela só:

- **Terminal embaixo** — o bash igual ao de hoje, com o Claude Code rodando dentro.
- **Editor no meio** — clica no arquivo, edita e salva, sem abrir nano.
- **Lateral de pastas** — com ícones, desliza ao abrir e fechar (animação em degraus, estilo pixelado assumido como estética, não limitação).
- **Jogos do lado** — pra jogar enquanto a IA trabalha.

## Decisões fechadas

| Assunto | Decisão |
|---|---|
| Base da janela | **Electron** (mesma base do VS Code e do Cate) |
| Caixa de terminal | **xterm.js** + node-pty (mesmas peças do VS Code; o ghostty-web é a reserva, encaixa no mesmo lugar se o xterm.js decepcionar) |
| Atalhos | **Quase nenhuma tecla é capturada: tudo passa direto pro bash.** Exceções decididas pelo Matheus: **Ctrl+J** esconde/mostra o terminal (como no VS Code; o bash perde o Ctrl+J-como-Enter só dentro do programa) e **Ctrl+Shift+C/V** copia/cola no terminal, igual ao Konsole. Ctrl+S salva, mas só com o editor em foco |
| Aparência da 1ª versão | Preto e branco, normal. Cores ficam pra depois. Obrigatório só: **ícones de pasta/arquivo na lateral** (fonte de ícones, não emoji) |
| Jogos garantidos | **Pac-Man e Tetris** (encaixam perfeito no estilo). Mario e outros: avaliar depois — emulador web existe, mas precisa de arquivo de cartucho próprio (questão legal) e teste de desempenho |

## Primeira versão (MVP)

Entra agora:
1. Terminal com bash funcionando igual ao Konsole e Claude Code rodando sem defeito — **é a peça crítica: se o Claude Code não rodar bem, o resto não adianta**.
2. Lateral de pastas com ícones, deslizando ao abrir/fechar.
3. Editor: clicar na lateral abre o arquivo, editar e salvar.

Fica pra depois: jogos, cores personalizadas, resto da estética.

## Avisos técnicos anotados na conversa

- Não abre por SSH (servidor do cocar continua precisando de terminal comum).
- Electron gasta ~300 MB de RAM; ok nos 11 GB do notebook.
- Fonte de ícones (Nerd Font) ainda não está instalada na máquina.

## Nome

"meu-terminal" é provisório, escolhido pelo Claude só pra criar a pasta. Matheus ainda vai batizar.
