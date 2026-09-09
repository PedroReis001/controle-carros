# Configurar login e proteção dos dados no Supabase

Faça isto **uma vez**, no painel do Supabase do projeto
(`https://supabase.com/dashboard` → seu projeto).

Depois destes passos, o app só abre para quem tem conta, e a tabela `dados`
deixa de ser lida/escrita por estranhos.

---

## 1. Desligar o cadastro aberto

**Authentication → Sign In / Providers → Email**

- Deixe **Email** habilitado.
- **Confirm email**: pode deixar **ligado** (mais seguro) ou desligado (mais
  simples). Se deixar ligado, ao criar cada usuário marque "Auto Confirm User"
  no passo 2.
- **Não** habilite "Allow new users to sign up" se essa opção existir — o app
  não tem tela de cadastro de propósito.

## 2. Criar as contas (uma para cada pessoa)

**Authentication → Users → Add user → Create new user**

- Informe **e-mail** e **senha**.
- Marque **Auto Confirm User** (assim entra direto, sem e-mail de confirmação).
- Repita para cada pessoa que vai usar o app (você, seu avô, etc.).

Para trocar a senha depois: **Users → (clique no usuário) → Reset password**.

## 3. Ligar o RLS e as políticas

**SQL Editor → New query** → cole e rode:

```sql
-- Liga o Row Level Security na tabela
alter table public.dados enable row level security;

-- Remove políticas antigas com estes nomes, se já existirem (evita erro ao repetir)
drop policy if exists "dados_select_logado" on public.dados;
drop policy if exists "dados_insert_logado" on public.dados;
drop policy if exists "dados_update_logado" on public.dados;

-- Só quem está logado pode ler
create policy "dados_select_logado"
  on public.dados for select
  to authenticated
  using (true);

-- Só quem está logado pode inserir
create policy "dados_insert_logado"
  on public.dados for insert
  to authenticated
  with check (true);

-- Só quem está logado pode atualizar
create policy "dados_update_logado"
  on public.dados for update
  to authenticated
  using (true)
  with check (true);
```

Observações:

- **Não** foi criada política de `delete` — o app nunca apaga a linha
  `frota:dados:v2` (só faz `upsert`), então deixar `delete` bloqueado é o certo.
- Todas as pessoas logadas compartilham a mesma linha de dados. Isso é
  intencional: é um app de família, todo mundo enxerga a mesma frota. A
  proteção é contra quem **não** tem conta.
- Se no painel aparecer uma política antiga do tipo "Enable read access for
  all users" / "public" na tabela `dados`, **apague** (Authentication →
  Policies → tabela `dados` → lixeira). Ela é o que deixava os dados abertos.

## 4. Conferir

No terminal (troque a URL e a chave pelas do seu projeto — a chave
`publishable` está no `index.html`):

```bash
curl -s -w '\n[HTTP %{http_code}]\n' \
  'https://SEU-PROJETO.supabase.co/rest/v1/dados?select=key' \
  -H 'apikey: SUA_CHAVE_PUBLISHABLE'
```

Agora tem que voltar **vazio** (`[]`) ou **erro 401/403**. Se ainda voltar os
dados, sobrou alguma política pública na tabela (passo 3, última observação).

Depois abra o app: ele deve pedir e-mail e senha, e entrar normalmente com uma
das contas criadas no passo 2.
