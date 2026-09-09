# Controle Carros

App de página única (PWA) para controlar a frota de aluguel de carros:
aluguel semanal por motorista, cadastro dos carros, manutenção/gastos e
balanço de quando cada carro se paga.

- **Frontend:** HTML/CSS/JS puro, tudo em [`index.html`](index.html).
- **Banco de dados:** [Supabase](https://supabase.com) — tabela `dados`
  (formato chave/valor; todo o estado do app fica em uma linha,
  `key = 'frota:dados:v2'`).
- **Offline:** [`sw.js`](sw.js) guarda o "casco" do app para abrir sem internet
  mostrando o último estado carregado.

## Rodar localmente

Precisa ser servido por HTTP (o service worker e o Face ID não funcionam em
`file://`):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Configuração do Supabase

As chaves ficam em `index.html` (procure por `SUPABASE_URL`). A chave usada é
do tipo `publishable` — ela é feita para ser pública.

### ⚠️ Segurança — pendente

A proteção real dos dados depende de **Row Level Security (RLS)** na tabela
`dados` do painel do Supabase. Para testar se hoje qualquer pessoa consegue
ler os dados:

```bash
curl -s -w '\n[HTTP %{http_code}]\n' \
  'https://SEU-PROJETO.supabase.co/rest/v1/dados?select=key' \
  -H 'apikey: SUA_CHAVE_PUBLISHABLE'
```

- Voltou `[]` ou erro `401/403` → RLS protegendo, ok.
- Voltou os dados → **está exposto**; configure RLS (idealmente junto com
  Supabase Auth, senão o app anônimo também deixa de funcionar).

O bloqueio por Face ID é apenas uma trava de tela local — **não protege os
dados no banco**.

## Como os dados são salvos

Como tudo fica em uma linha só, dois aparelhos editando ao mesmo tempo
poderiam se sobrescrever. Antes de gravar, o app relê o estado do servidor e
faz uma mesclagem por `id` (registro alterado localmente vence; registro não
tocado segue o servidor). O app também recarrega sozinho ao voltar ao foco e
a cada 60s, além do botão **Atualizar**.
