# Meu app · versão 3 (PWA)

Visual da direção 1a (verde-menta, escuro). Funciona offline; com Supabase configurado, sincroniza entre aparelhos com login.

## Módulos
Tela inicial com um resumo de cada módulo:
- **Nutrição**: calorias e macros do dia (anel), refeições editáveis, lançamento de alimentos e histórico.
- **Treino**: tipo do dia, treino do dia, gasto (Apple Watch ou estimativa), balanço do dia e da semana, plano de gasto.
- **Finanças**: resumo do mês, contas (parcelas, recorrentes, Sophia, entradas, variáveis) e plano de poupança para a viagem. Código em `fin.js`.
- **Histórico**: calorias, macros e peso num relatório só (7 a 90 dias). O peso pode ser registrado a qualquer data, com frequência livre, diária, semanal ou mensal.

Tudo o que o usuário cadastra (incluindo finanças e meta automática) sincroniza no mesmo registro `user_state`; não há tabela nova. Para trazer o Controle Financeiro antigo: Ajustes > Importar finanças (JSON).

## Metas de calorias e macros
- Sem plano alimentar importado, o app **não sugere quanto comer**: mostra o que foi ingerido e compara com o gasto do dia.
- Com plano da nutricionista, a meta é a do plano. Toda semana o app olha o peso médio e, se o gasto mudou 60 kcal ou mais, pergunta se o usuário quer manter o plano ou atualizar (a atualização soma a diferença de gasto e preserva o déficit/superávit do plano; dá para voltar às metas originais).
- **Meta automática** (opcional, Ajustes > Meta automática): gasto pela fórmula de Mifflin-St Jeor com o peso médio de 7 dias, calibrado pelo gasto real quando há 3 semanas de refeições e pesagens (7.700 kcal por kg), mais ou menos um ajuste pelo objetivo e ritmo, com piso na taxa metabólica basal. Revisão semanal com confirmação. É uma estimativa e não substitui orientação profissional.

## Arquivos
- `index.html`, `app.css`, `app.js`, `fin.js`: o app (sem build, sem dependências)
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

## Plano alimentar (nutricionista)
Em Ajustes > Plano alimentar. As metas do plano (kcal, proteína, carbo e gordura, para dia de treino e de descanso) substituem o cálculo automático em todo o app. Sem plano, o app continua calculando a meta.
- **Importar o plano**: envie um arquivo (CSV, TXT ou JSON) ou cole o texto. De PDF ou Word, copie o texto e cole. Antes de salvar há uma tela de conferência; itens sem calorias são marcados com ⚠ e podem ser preenchidos ou removidos.
- **Texto livre**: uma linha com o nome da refeição (Café da manhã, Almoço, 1ª refeição...) e, abaixo, os itens (`150 g de arroz`, `2 ovos`, `Frango 120 g`). Calorias e macros vêm da tabela de alimentos; se a linha tiver `198 kcal`, esse valor vale.
- **CSV**: use "Baixar modelo CSV". Colunas `Dia;Refeição;Alimento;Qtd;Unid;Kcal;P;C;G` (kcal e macros em branco são buscados na tabela). `Dia` pode ser Treino, Descanso ou vazio (vale para os dois), então as quantidades podem mudar entre dia de treino e de descanso. Linhas `Meta;Treino;kcal;P;C;G;gasto` e `Meta;Descanso;...` definem as metas do dia.
- Ao salvar, o app oferece usar os nomes das refeições do plano (por exemplo Almoço, Refeição da tarde, Jantar); lançamentos antigos passam para a refeição da mesma posição.
- **Lançar**: na tela Lançar, a refeição escolhida mostra os itens do plano com a quantidade prescrita; é possível lançar item a item ou tudo de uma vez.
- **Importar do app antigo** também traz a aba Metas e o grupo "Plano alimentar" da planilha.

## Gasto diário do Apple Watch
Na tela Hoje, o campo "Gasto do dia (Apple Watch)" recebe o total do dia (ativas + em repouso). Ele vale para o saldo da semana e do histórico. Campo vazio volta ao gasto estimado. O app não lê o Apple Saúde sozinho (um PWA no iPhone não tem acesso); o valor é digitado.

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
