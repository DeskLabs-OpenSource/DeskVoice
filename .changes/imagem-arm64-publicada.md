---
impact: new_capability
section: added
title: As imagens publicadas também rodam em servidor ARM
---

Servidor com processador ARM de 64 bits (as Ampere A1 do plano gratuito da Oracle, as Graviton)
agora instala puxando a imagem publicada, como no x86_64: não é mais preciso construir as três
imagens na própria VPS. Quem já tem uma instalação em ARM construída na máquina passa para a
versão publicada com `bash install/update.sh --to <versão>`, sem reinstalar. Crédito: @webtecnica.
