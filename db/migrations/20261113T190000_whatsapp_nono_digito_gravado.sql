-- O número conectado, gravado antes de o conversor devolver o nono dígito (`phoneOfWhatsAppId`).
--
-- O WhatsApp manda o celular brasileiro antigo sem o nono dígito, e as duas telas gravavam assim
-- (`+553188887777`). O conversor novo só regrava quando a sessão muda de estado, então o número
-- velho ficava até reconectar, e o aviso de "mesmo número" comparava um gravado com nove e outro
-- sem. A regra é a mesma do conversor: 55, DDD sem zero, oito dígitos começando de 6 a 9.
update whatsapp_sessions
   set phone_e164 = '+55' || substr(phone_e164, 4, 2) || '9' || substr(phone_e164, 6)
 where phone_e164 ~ '^\+55[1-9][1-9][6-9][0-9]{7}$';
update whatsapp_call_sessions
   set phone_e164 = '+55' || substr(phone_e164, 4, 2) || '9' || substr(phone_e164, 6)
 where phone_e164 ~ '^\+55[1-9][1-9][6-9][0-9]{7}$';
