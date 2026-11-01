# Como trabalhar neste projeto (peso-calorias)

## Estilo
- Seja rápido e direto: respostas curtas, sem explicar o que não foi pedido.
- Faça o que for pedido e confirme só o resultado, em poucas linhas.
- Teste só o essencial.
- Pergunte só se algo realmente depender do Felipe; em dúvida pequena, escolha o mais razoável e avise numa linha.
- O Felipe usa o microfone (mão machucada): pode haver palavras trocadas, releia com cuidado.

## Git e publicação
- Não publique (push na main) sem o Felipe pedir. Commitar só quando ele pedir.
- Repositório: github.com/FelipeSzwec/peso-calorias. O app é publicado pelo GitHub Pages
  (felipeszwec.github.io/peso-calorias/), cerca de 1 minuto depois do push na main.
- O PC do Felipe não tem login do GitHub: o push é feito pela nuvem (add_repo com acesso de escrita).
- No Git da pasta do PC use `-c core.autocrlf=true` (arquivos com quebra de linha do Windows).
- Para o Felipe aprovar antes de publicar, faça uma prévia com dados de demonstração.

## Regras do app
- O plano alimentar sempre manda nas metas. A meta automática só vale quando não há plano.
- O ajuste semanal só sugere; nada muda sem o Felipe aplicar.
- Proteína, carbo e gordura são sempre editáveis nas sugestões; faixas de estudos são só aviso.
- Ao mudar app.js, aumente a versão `CV` em sw.js se mexer no service worker.
