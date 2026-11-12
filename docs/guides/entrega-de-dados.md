# Entregar os dados de uma pessoa

Quem ligou para a sua central tem direito de saber o que a instalação guarda sobre ele, e de levar
isso para outro fornecedor. Este guia é o caminho curto para atender esse pedido sem planilha feita à
mão.

O que a instalação guarda sobre um telefone:

- **chamadas** em que ele aparece como origem ou destino — horário, situação, duração, custo e o
  resumo, quando existe;
- **eventos** dessas chamadas — o que o agente fez, e a transcrição da conversa enquanto ela existir
  (depois do expurgo, sai o marcador `{"expurgado": true}` no lugar do texto, veja
  [Conformidade no Brasil](conformidade-brasil.md));
- **lista de não ligar**, se o número estiver nela, com o motivo e a data.

## O comando

```console
$ bash install/exportar-dados.sh --telefone +5531999998888
  ✓ Ficha de +5531999998888 em /root/DeskVoice/ficha-5531999998888-2026-11-12.ndjson (permissão 600).
    chamadas: 2 · eventos: 14 · lista de não ligar: 1
  ⚠ O arquivo tem dado pessoal. Entregue pelo canal combinado e apague depois: rm /root/...
```

O telefone vai em E.164, no mesmo formato que o painel mostra. `--organizacao <uuid>` limita a uma
organização; `--saida <arquivo>` escolhe o caminho. O comando **não sobrescreve** ficha existente, e
não altera nada no banco.

## O que sai, e o que não sai

Sai o que tem aquele telefone: chamadas, eventos delas e a entrada na lista de não ligar. Não sai
dado de outra pessoa, nem configuração da instalação — agente, tronco e chaves ficam de fora.

Duas limitações que valem dizer a quem pediu:

1. **A busca é pelo número.** Se a mesma pessoa ligou de outro telefone, rode de novo com cada
   número que você tiver dela.
2. **Transcrição expurgada não volta.** Se o prazo de retenção já passou, o texto não existe mais —
   a ficha mostra o marcador, e isso é o correto: o dado foi apagado a pedido da sua política.

## Depois de entregar

O arquivo é dado pessoal fora do banco. Entregue pelo canal combinado com quem pediu, guarde o
registro de quando e para quem entregou, e apague o arquivo do servidor. O script já cria com
permissão `600`, mas permissão não substitui apagar.
