# Controle de Expedição — Oranges Alimentos

Painel público apenas leitura em `/`; administrador em `/login` e `/admin`.

Variáveis necessárias: `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `NODE_ENV=production`.

**IMPORTANTE:** O Render gratuito não oferece armazenamento persistente em disco. Use PostgreSQL persistente e com backup. Não cadastre dados reais antes de configurar e validar esse banco. Não use senha no código.

Atualização do painel público a cada 3 segundos. Integração AIS não conectada.
