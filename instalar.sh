#!/usr/bin/env bash
# Copia a Bigorna da pasta do projeto pra ~/.local/opt/bigorna, que é a cópia
# que o menu abre. Mexer no projeto não afeta a instalada até rodar isto de novo.
set -euo pipefail

origem="$(cd "$(dirname "$0")" && pwd)"
destino="$HOME/.local/opt/bigorna"
atalho="$HOME/.local/share/applications/bigorna.desktop"

mkdir -p "$destino"
rsync -a --delete --exclude .git "$origem/" "$destino/"
(cd "$destino" && npm prune --omit=dev --no-audit --no-fund >/dev/null)

cat > "$atalho" <<EOF
[Desktop Entry]
Type=Application
Name=Bigorna
Comment=Terminal com editor, pastas e abas por repositório
Exec=$destino/node_modules/electron/dist/electron $destino
Icon=bigorna
Terminal=false
Categories=TerminalEmulator;Development;
StartupWMClass=bigorna
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true

echo "Bigorna instalada em $destino ($(git -C "$origem" log -1 --format='%h %s'))"
