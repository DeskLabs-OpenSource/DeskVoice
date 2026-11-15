---
impact: new_capability
section: added
title: As imagens publicadas também rodam em servidor ARM
---

A partir desta versão, servidor com processador ARM de 64 bits (as Ampere A1 do plano gratuito da
Oracle, as Graviton) instala puxando a imagem publicada, como no x86_64: não é mais preciso
construir as três imagens na própria VPS. As versões anteriores continuam sem imagem ARM: em ARM,
o instalador e o atualizador conferem antes de baixar e, se a versão pedida não tem a imagem,
param antes de mexer em qualquer coisa e dizem que dá para construir com `--build`. Quem já tem
uma instalação em ARM construída na máquina passa para esta versão com
`bash install/update.sh --to <versão>`, sem reinstalar. Crédito: @webtecnica.
