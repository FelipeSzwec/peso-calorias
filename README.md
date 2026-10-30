# Peso e Calorias · versão 2 (PWA)

Visual da direção 1a (verde-menta, escuro). Funciona offline; com Supabase configurado, sincroniza entre aparelhos com login.

## Arquivos
- `index.html`, `app.css`, `app.js`: o app (sem build, sem dependências)
- `config.js`: URL e chave pública do Supabase
- `foods.json`: ~40 alimentos de exemplo (valores aproximados)
- `sw.js`, `manifest.json`, ícones: instalação e uso offline
- `supabase/schema.sql`: tabelas, validações e regras de acesso (RLS)

## Colocar no ar
1. Crie um projeto em supabase.com (gratuito).
2. SQL Editor: cole e execute `supabase/schema.sql`.
3. Authentication > Providers > Email: deixe ativo. Em Authentication > URL Configuration, coloque o endereço onde o app será publicado.
4. Project Settings > API: copie a **Project URL** e a chave **anon/publishable** para `config.js`. Nunca use a chave `service_role`.
5. Publique a pasta inteira em hospedagem HTTPS (GitHub Pages, Netlify, Cloudflare Pages). Abra no celular e use "Adicionar à tela de início".
6. Se não preencher `config.js`, o app funciona só no aparelho, sem conta.

## Trazer a lista de alimentos da planilha
Na aba **Alimentos**: Arquivo > Fazer download > CSV. No app: Ajustes > Importar alimentos (CSV). Colunas esperadas: Alimento; Grupo; Unidade; Porção; Kcal; P; C; G.

## Segurança
- Login por e-mail e senha (Supabase Auth); a sessão renova sozinha.
- Regras RLS: cada conta só lê e grava as próprias linhas. Validações de faixa no banco.
- `updated_at` definido pelo servidor (não depende do relógio do celular).
- Sem token no código nem na URL. A chave anon é pública por desenho e inofensiva com RLS ativo.
- Política de conteúdo (CSP) no `index.html`: só scripts do próprio app e conexão apenas com `*.supabase.co`.
- Textos digitados são escapados antes de aparecer na tela; o CSV exportado neutraliza fórmulas.
- PIN: PBKDF2 (200 mil iterações) com sal, bloqueio progressivo após 5 erros e trava ao ficar 1 minuto em segundo plano. É uma trava de tela local, não substitui a senha da conta.
- A sessão fica no armazenamento do navegador (limite de qualquer PWA sem servidor próprio).

## Limites conhecidos
- Lembretes só disparam com o app aberto. Aviso em segundo plano exige push com servidor.
- Conflitos entre aparelhos: vale a última gravação do servidor.
- Os valores de `foods.json` são aproximados; importe sua tabela para precisão.
- Os dados antigos da planilha (lançamentos, peso) não são migrados automaticamente; posso gerar um importador se quiser.
