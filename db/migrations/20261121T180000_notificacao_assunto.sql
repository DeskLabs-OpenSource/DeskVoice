-- O assunto do aviso no painel (central de configuração, parte 8 · acompanhamento, DESA-323).
--
-- O aviso de atualização vai para o painel de toda organização, porque a atualização derruba o
-- sistema de todas, mas a tela do resultado só abre para quem administra a instalação. `subject`
-- marca o aviso de atualização, para o sino dar o link só a quem consegue segui-lo. Os outros avisos,
-- e os antigos, ficam com nulo.
alter table notifications add column subject text check (subject in ('installation_update'));
