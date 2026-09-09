# Controle Carros

App de página única (PWA) para controlar a frota de aluguel de carros:
aluguel semanal por motorista, cadastro dos carros, manutenção/gastos e
balanço de quando cada carro se paga.

- **Frontend:** HTML/CSS/JS puro, tudo em [`index.html`](index.html).
- **Login:** [Supabase Auth](https://supabase.com) — e-mail e senha. Depois do
  primeiro acesso, cada aparelho pode criar um **código de 4 números** pra
  reabrir sem digitar tudo (fica só no aparelho, como hash; não substitui o
  login). Botão **Código** no topo troca ou remove.
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

## Caderneta

Cada carro tem um campo "Aluguel começou em". A partir dessa data (ou do
primeiro pagamento, se em branco), o app conta uma semana de aluguel por
semana e compara com o que foi pago — a semana atual fica de fora. O
resultado aparece como "Devendo R$ X" / "Adiantado R$ X" / "Em dia" na aba
Carros, numa seção "Devendo de semanas passadas" na aba Semana, e detalhado
semana a semana em "Ver" → Caderneta (com botão "Receber" por semana).

A aba Semana também mostra uma seção **Hoje** (motoristas cujo dia de
pagamento é hoje e ainda não quitaram) e um botão **Voltar pra semana de
hoje** quando você navega para outra semana.

## Registrar pagamento

Cada carro em aberto tem um botão grande **"Pagou R$ X"** que lança num
toque o valor que falta da semana, com a data de hoje e a forma de
pagamento mais usada por aquele motorista. **"Outro valor"** abre o painel
completo (valor parcial, adiantamento, outra data/forma). Depois de
qualquer lançamento aparece **"... · Desfazer"** por alguns segundos —
um toque remove o lançamento.

## Carro vendido — nunca perde histórico

Carro tem `status`: **ativo** (padrão) ou **vendido**. Em vez de apagar um
carro (o que apagava junto os pagamentos e gastos), você o **marca como
vendido** em "Ver carro" — guardando **data e valor da venda**. Ele some do
dia a dia (Semana, Hoje, alertas, lançar gasto) mas continua:

- na aba Carros, numa seção **"Vendidos"** recolhida no fim;
- na aba Balanço, com o **resultado final** (aluguel + venda − compra − gastos);
- em "Ver carro", com o histórico e a caderneta congelados na data da venda.

Dá pra **Reativar** um carro marcado por engano. Só é possível **excluir de
vez** um carro que não tenha nenhum lançamento (cadastro errado).

## Balanço — payback e rendimento

Cada carro mostra:

- **Rendeu de aluguel / Gastou / Sobrou** (resultado operacional = aluguel −
  gastos: manutenção, pneus, seguro, IPVA, multas...).
- **Recuperou X% dos R$ Y** — quanto do preço de compra já voltou.
- **Falta ~1 ano e 4 meses** — payback, no ritmo atual.
- **Rendimento: +45% ao ano** — resultado mensal médio × 12 ÷ preço de
  compra. Serve pra comparar modelos (Voyage 51% × Onix 45% × HB20 42%).
  Carro com menos de 3 meses de frota mostra "ainda cedo pra calcular".

No topo: **Rendimento da frota** (média ponderada pelo capital). Carro
vendido mostra o **resultado final** fechado (aluguel + venda − compra −
gastos) e o % sobre a compra.

> O rendimento **não desconta a desvalorização** do carro — o retorno real
> é um pouco menor. Isso está avisado na tela.

## Como os dados são salvos

Como tudo fica em uma linha só, dois aparelhos editando ao mesmo tempo
poderiam se sobrescrever. Antes de gravar, o app relê o estado do servidor e
faz uma mesclagem por `id` (registro alterado localmente vence; registro não
tocado segue o servidor). O app também recarrega sozinho ao voltar ao foco e
a cada 60s, além do botão **Atualizar**.
