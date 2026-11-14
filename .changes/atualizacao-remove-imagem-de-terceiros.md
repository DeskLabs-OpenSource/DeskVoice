---
impact: nothing_changes
section: fixed
title: A atualização remove a imagem de terceiros que a versão nova deixou de usar
---

Quando uma versão troca a imagem de um serviço de terceiros (como o WaCalls, que passou da imagem oficial para a mantida pelo projeto, ou o WAHA, cuja imagem passa de 3 GB), a atualização deixava a antiga no disco da VPS. Agora, depois de subir tudo e conferir, ela remove a imagem que a versão de onde saiu fixava e a nova não fixa mais, pelo endereço exato e sem forçar: imagem que algum contêiner usa fica, com um aviso, e imagem de outro sistema na mesma VPS não é tocada. Voltar para a versão anterior passa a pedir internet para baixá-la de novo. Nada a fazer em instalações existentes. Crédito: @melgarafael.
