# Controle Carros

App de página única (PWA) para controlar a frota de aluguel de carros:
aluguel semanal por motorista, cadastro dos carros, manutenção/gastos e
balanço de quando cada carro se paga.

- **Frontend:** HTML/CSS/JS puro, tudo em [`index.html`](index.html).
- **Login:** [Supabase Auth](https://supabase.com) — e-mail e senha.
- **Banco de dados:** Supabase — tabela `dados` (formato chave/valor; todo o
  estado do app fica em uma linha, `key = 'frota:dados:v2'`).
- **Offline:** [`sw.js`](sw.js) guarda o "casco" do app para abrir sem internet
  mostrando o último estado carregado.

## Rodar localmente

Precisa ser servido por HTTP (o service worker e o login não funcionam em
`file://`):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Configuração do Supabase

As chaves ficam em `index.html` (procure por `SUPABASE_URL`). A chave é do
tipo `publishable` — feita para ser pública. A proteção de verdade vem do
**login + Row Level Security**. Ver [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md)
para o passo a passo (criar contas e aplicar o SQL das políticas).

### Testar se os dados estão protegidos

```bash
curl -s -w '\n[HTTP %{http_code}]\n' \
  'https://SEU-PROJETO.supabase.co/rest/v1/dados?select=key' \
  -H 'apikey: SUA_CHAVE_PUBLISHABLE'
```

- Voltou `[]` ou erro `401/403` → protegido, ok.
- Voltou os dados → **exposto**; falta aplicar o RLS de `SUPABASE_SETUP.md`.

## Como os dados são salvos

Como tudo fica em uma linha só, dois aparelhos editando ao mesmo tempo
poderiam se sobrescrever. Antes de gravar, o app relê o estado do servidor e
faz uma mesclagem por `id` (registro alterado localmente vence; registro não
tocado segue o servidor). O app também recarrega sozinho ao voltar ao foco e
a cada 60s, além do botão **Atualizar**.
