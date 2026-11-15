---
impact: new_capability
section: added
title: A gravação fecha com impressão digital, para provar que o áudio é o original
---

Ao fim de cada ligação gravada, o arquivo `.wav` passa a ser lido em stream e resumido em SHA-256, e a linha do tempo da chamada ganha o evento `recording_saved` com o tamanho e a impressão digital do arquivo — antes o `.wav` era fechado e ninguém guardava nada que o identificasse. Isso muda o peso de uma gravação numa contestação: sem impressão digital, qualquer cópia do arquivo tem o mesmo valor de qualquer outra, e a resposta a "essa gravação é a original?" depende da palavra de quem apresenta; com ela, o áudio apresentado pode ser conferido contra o que a chamada registrou, e uma edição deixa de ser indetectável. A leitura é por stream porque uma hora de conversa passa de 100 MB e o fim da chamada não é lugar para carregar o arquivo inteiro na memória. Crédito: @webtecnica.
