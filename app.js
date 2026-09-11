

const SUPABASE_URL = "https://gslnpiegtvkjvngdpqhf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_OkA5pfbvxJSShR2mMA9sNA_xJKmvJE9";

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// Substitui o window.storage que o app usava dentro da Claude
// por um que lê e grava numa tabela do Supabase — mesma "forma", outro lugar.
window.storage = {
  async get(key){
    const { data, error } = await sb.from('dados').select('value').eq('key', key).maybeSingle();
    if(error) throw error;
    if(!data) throw new Error('sem dados ainda');
    return {key, value: data.value, shared:true};
  },
  async set(key, value){
    const { error } = await sb.from('dados').upsert({ key, value, atualizado_em: new Date().toISOString() });
    if(error) throw error;
    return {key, value, shared:true};
  }
};

// Service worker: deixa o app abrir offline mostrando o último estado carregado.
if('serviceWorker' in navigator){
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

const CHAVE = 'frota:dados:v2';

/* ================= LOGIN (Supabase Auth) ================= *
 * Agora é login de verdade: e-mail e senha verificados pelo Supabase.
 * A sessão fica guardada no aparelho (localStorage) e é renovada
 * sozinha, então só precisa entrar de novo depois de "Sair" ou de
 * ficar muito tempo sem abrir. As contas são criadas no painel do
 * Supabase (Authentication -> Users). Não há cadastro aberto aqui
 * de propósito: assim ninguém de fora entra nos dados. */

function mostrarTelaLogin(){
  appLiberado = false;
  $('cartaoPin').classList.add('oculto');
  $('cartaoLogin').classList.remove('oculto');
  $('bloqueio').classList.remove('oculto');
  $('appConteudo').classList.add('oculto');
  $('loginSenha').value = '';
  setTimeout(() => $('loginEmail').focus(), 60);
}

function entrarNoApp(){
  $('bloqueio').classList.add('oculto');
  $('cartaoPin').classList.add('oculto');
  $('appConteudo').classList.remove('oculto');
  iniciarApp();
}

async function fazerLogin(e){
  e.preventDefault();
  $('bloqueioNota').textContent = '';
  $('loginBtn').disabled = true;
  $('loginBtn').textContent = 'Entrando…';
  const email = $('loginEmail').value.trim();
  const senha = $('loginSenha').value;
  const { error } = await sb.auth.signInWithPassword({ email, password: senha });
  $('loginBtn').disabled = false;
  $('loginBtn').textContent = 'Entrar';
  if(error){
    $('bloqueioNota').textContent = /Email not confirmed/i.test(error.message)
      ? 'Esse e-mail ainda não foi confirmado.'
      : 'E-mail ou senha incorretos.';
    return;
  }
  // Logou de verdade. Se ainda não tem código rápido neste aparelho, oferece criar.
  if(temPin()) entrarNoApp();
  else abrirTelaPin('criar');
}

async function sair(){
  if(timerSync){ clearInterval(timerSync); timerSync = null; }
  fechar();
  await sb.auth.signOut();
  dados = {carros:[], pagamentos:[], gastos:[], indisponibilidades:[], exemplo:false};
  baseRemoto = null;
  mostrarTelaLogin();
}

async function iniciarSessao(){
  const { data } = await sb.auth.getSession();
  if(data.session){
    if(temPin()) abrirTelaPin('entrar');
    else entrarNoApp();
  }else{
    mostrarTelaLogin();
  }
  // Se o token expirar e não der pra renovar, o Supabase emite SIGNED_OUT.
  sb.auth.onAuthStateChange((evento) => {
    if(evento === 'SIGNED_OUT') mostrarTelaLogin();
  });
}
/* ================= FIM DO LOGIN ================= */

/* ================= CÓDIGO DE ACESSO RÁPIDO (PIN) ================= *
 * Depois de logar uma vez com e-mail e senha, a pessoa pode criar um
 * código de 4 números pra reabrir o app sem digitar tudo de novo.
 *
 * O código NÃO é a segurança dos dados — quem protege os dados é a
 * sessão do Supabase (essa sim exige e-mail e senha). O PIN é só uma
 * tela de bloqueio local, pra conveniência, por cima do login real.
 * Fica guardado só neste aparelho, como hash + sal (não em texto puro). */
const CHAVE_PIN = 'frota:pin:v1';
let pinModo = 'entrar';      // 'entrar' | 'criar' | 'confirmar'
let pinBuffer = '';
let pinPrimeiro = '';
let pinTentativas = 0;

function temPin(){
  try{ return !!localStorage.getItem(CHAVE_PIN); }catch(e){ return false; }
}
function removerPin(){
  try{ localStorage.removeItem(CHAVE_PIN); }catch(e){}
}
async function hashPin(pin, sal){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sal + '|' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function salvarPin(pin){
  const sal = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await hashPin(pin, sal);
  try{ localStorage.setItem(CHAVE_PIN, JSON.stringify({ sal, hash })); }catch(e){}
}
async function conferirPin(pin){
  try{
    const { sal, hash } = JSON.parse(localStorage.getItem(CHAVE_PIN));
    return (await hashPin(pin, sal)) === hash;
  }catch(e){ return false; }
}

function abrirTelaPin(modo){
  pinModo = modo; pinBuffer = ''; pinPrimeiro = '';
  $('pinNota').textContent = '';
  $('cartaoLogin').classList.add('oculto');
  $('cartaoPin').classList.remove('oculto');
  $('bloqueio').classList.remove('oculto');
  $('appConteudo').classList.add('oculto');
  desenharTelaPin();
}
function desenharTelaPin(){
  const textos = {
    entrar:    ['Digite seu código', 'Código de 4 números pra entrar', 'Esqueci meu código'],
    criar:     ['Crie um código', 'Escolha 4 números fáceis de lembrar', 'Agora não'],
    confirmar: ['Confirme o código', 'Digite os mesmos 4 números de novo', 'Recomeçar']
  }[pinModo];
  $('pinTitulo').textContent = textos[0];
  $('pinSub').textContent = textos[1];
  $('pinLink').textContent = textos[2];
  [...$('pinPontos').children].forEach((p, i) => p.classList.toggle('cheio', i < pinBuffer.length));
}
function digitarPin(n){
  if(pinBuffer.length >= 4) return;
  $('pinNota').textContent = '';
  pinBuffer += n;
  desenharTelaPin();
  if(pinBuffer.length === 4) setTimeout(concluirPin, 140);
}
function apagarPin(){
  pinBuffer = pinBuffer.slice(0, -1);
  desenharTelaPin();
}
async function concluirPin(){
  if(pinModo === 'criar'){
    pinPrimeiro = pinBuffer; pinBuffer = ''; pinModo = 'confirmar';
    desenharTelaPin();
    return;
  }
  if(pinModo === 'confirmar'){
    if(pinBuffer !== pinPrimeiro){
      pinBuffer = ''; pinPrimeiro = ''; pinModo = 'criar';
      desenharTelaPin();
      $('pinNota').textContent = 'Os códigos não bateram. Escolha de novo.';
      return;
    }
    await salvarPin(pinBuffer);
    entrarNoApp();
    aviso('Código criado');
    return;
  }
  // modo 'entrar'
  if(await conferirPin(pinBuffer)){
    pinTentativas = 0;
    entrarNoApp();
  }else{
    pinTentativas++;
    pinBuffer = '';
    desenharTelaPin();
    if(pinTentativas >= 5){
      removerPin();
      $('pinNota').textContent = 'Muitas tentativas. Entre com e-mail e senha.';
      setTimeout(() => { sb.auth.signOut(); mostrarTelaLogin(); }, 1400);
    }else{
      $('pinNota').textContent = 'Código errado (' + pinTentativas + ' de 5).';
    }
  }
}
function acaoPinLink(){
  if(pinModo === 'entrar'){
    removerPin();
    mostrarTelaLogin();
  }else if(pinModo === 'criar'){
    entrarNoApp();
  }else{
    pinModo = 'criar'; pinBuffer = ''; pinPrimeiro = '';
    desenharTelaPin();
  }
}
function gerenciarCodigo(){
  const tem = temPin();
  abrir(`<h3>Código de acesso</h3>
    <p class="sub">${tem
      ? 'Você entra neste aparelho com um código de 4 números. Ele não substitui o e-mail e a senha — é só um atalho.'
      : 'Crie um código de 4 números pra reabrir o app sem digitar e-mail e senha toda vez. Vale só neste aparelho.'}</p>
    <div class="acoes" style="flex-direction:column">
      <button class="btn" onclick="fechar(); abrirTelaPin('criar')">${tem ? 'Trocar código' : 'Criar código'}</button>
      ${tem ? `<button class="btn-vazio" onclick="fechar(); removerPin(); aviso('Código removido')">Remover código</button>` : ''}
      <button class="btn-vazio" onclick="fechar()">Cancelar</button>
    </div>`);
}
/* ================= FIM DO PIN ================= */

const CATEGORIAS = ['Manutenção','Pneus','Revisão','IPVA / Licenciamento','Seguro','Multa','Outro'];
const RECORRENTES = ['IPVA / Licenciamento','Seguro','Revisão','Pneus'];
const $ = id => document.getElementById(id);
const moeda = v => Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:0,maximumFractionDigits:2});
const esc = s => String(s??'').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

let dados = {carros:[], pagamentos:[], gastos:[], indisponibilidades:[], exemplo:false};
let aba = 'semana', offsetSemana = 0;
let baseRemoto = null;      // último estado confirmado no servidor — usado pra mesclar antes de gravar
let appLiberado = false;    // vira true só quando os dados carregaram de verdade
let salvando = false;       // trava o recarregamento automático enquanto grava
let timerSync = null;
const clonar = x => JSON.parse(JSON.stringify(x));

/* ---------------- datas (semana começa na segunda) ---------------- */
function segundaDe(d){
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay()+6)%7));
  return x;
}
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const hoje = () => iso(new Date());
function semanaAtiva(){ const s = segundaDe(new Date()); s.setDate(s.getDate()+offsetSemana*7); return s; }
function rotuloSemana(seg){
  const dom = new Date(seg); dom.setDate(dom.getDate()+6);
  const dd = d => String(d.getDate()).padStart(2,'0');
  const mm = d => d.toLocaleDateString('pt-BR',{month:'short'}).replace('.','');
  return seg.getMonth()===dom.getMonth() ? `${dd(seg)} a ${dd(dom)} de ${mm(dom)}`
                                         : `${dd(seg)} de ${mm(seg)} a ${dd(dom)} de ${mm(dom)}`;
}
const dataBR = s => s ? new Date(s+'T12:00').toLocaleDateString('pt-BR') : '';
const diasAte = s => Math.round((new Date(s+'T12:00') - new Date(hoje()+'T12:00'))/86400000);
const addDias = (s, n) => { const d = new Date(s+'T12:00'); d.setDate(d.getDate()+n); return iso(d); };

/* ---------------- armazenamento ----------------
 * Tudo fica numa linha só do Supabase (um JSON grande). Pra dois aparelhos
 * não apagarem o trabalho um do outro, antes de gravar a gente relê o que
 * está no servidor e faz uma mesclagem de 3 vias por id:
 *   - registro que só mudou aqui  -> vale o daqui (inclui exclusão local)
 *   - registro que não mexemos    -> vale o do servidor (inclui mudança de outro aparelho)
 * Em conflito no mesmo registro, a alteração local vence. */
function indexarPorId(arr){
  const m = {};
  (arr||[]).forEach(x => { if(x && x.id != null) m[x.id] = x; });
  return m;
}
function mesclar(base, local, remoto){
  const saida = { exemplo: !!(local.exemplo && remoto.exemplo) };
  ['carros','pagamentos','gastos','indisponibilidades'].forEach(col => {
    const b = indexarPorId(base && base[col]);
    const l = indexarPorId(local[col]);
    const r = indexarPorId(remoto[col]);
    const ids = new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)]);
    const lista = [];
    ids.forEach(id => {
      const mudouAqui = JSON.stringify(b[id] || null) !== JSON.stringify(l[id] || null);
      if(mudouAqui){
        if(l[id]) lista.push(l[id]);        // adicionado ou editado aqui (se sumiu, foi apagado aqui)
      }else{
        if(r[id]) lista.push(r[id]);        // segue o servidor (se sumiu lá, foi apagado no outro aparelho)
      }
    });
    saida[col] = lista;
  });
  return saida;
}

async function carregar(){
  let bruto;
  try{
    bruto = await window.storage.get(CHAVE);
  }catch(e){
    const msg = String((e && e.message) || e || '');
    if(msg.includes('sem dados ainda')){
      dados = semente();          // primeira vez de verdade: pode semear
      baseRemoto = null;
      await salvar();
      return;
    }
    throw e;                      // rede fora do ar / outro erro: NÃO sobrescreve nada
  }
  let novos;
  try{ novos = JSON.parse(bruto.value); }
  catch(e){ throw new Error('Os dados salvos estão ilegíveis — não vou gravar por cima.'); }
  dados = normalizar(novos);
  baseRemoto = clonar(dados);
}
/* garante que os arrays esperados existem (dados antigos não têm indisponibilidades) */
function normalizar(d){
  d = d || {};
  ['carros','pagamentos','gastos','indisponibilidades'].forEach(k => { if(!Array.isArray(d[k])) d[k] = []; });
  return d;
}

async function salvar(){
  salvando = true;
  try{
    if(baseRemoto){
      let remoto = null;
      try{ remoto = JSON.parse((await window.storage.get(CHAVE)).value); }
      catch(e){ remoto = null; }
      if(remoto) dados = mesclar(baseRemoto, dados, remoto);
    }
    await window.storage.set(CHAVE, JSON.stringify(dados));
    baseRemoto = clonar(dados);
    return true;
  }catch(e){
    aviso('Não deu pra salvar agora. Tente de novo.');
    return false;
  }finally{
    salvando = false;
  }
}

/* Recarrega em silêncio (sem tela de "carregando") pra pegar o que outro
 * aparelho gravou. Não roda com um formulário aberto pra não atrapalhar. */
async function recarregarSuave(){
  if(!appLiberado || salvando) return;
  if($('painel').classList.contains('aberto')) return;
  try{
    const remoto = normalizar(JSON.parse((await window.storage.get(CHAVE)).value));
    if(JSON.stringify(remoto) !== JSON.stringify(dados)){
      dados = remoto;
      baseRemoto = clonar(remoto);
      render();
      aviso('Dados atualizados');
    }
  }catch(e){ /* silencioso: mantém o que já está na tela */ }
}

const novoId = () => Date.now().toString(36)+Math.random().toString(36).slice(2,6);

function semente(){
  const seg = new Date(segundaDe(new Date()));
  const semN = n => { const d = new Date(seg); d.setDate(d.getDate() + n*7); return iso(d); };
  const s = semN(0), sa = semN(-1);
  const daqui = n => { const d = new Date(); d.setDate(d.getDate()+n); return iso(d); };
  let pid = 0;
  // pagamentos semanais de `carro` (R$ `valor`/semana) de semN(ini) até semN(fim), inclusive.
  // opts.pular = semanas sem pagamento; opts.valores = { semana: valor pago } sobrescreve.
  const semanais = (carro, valor, forma, ini, fim, opts={}) => {
    const out = [];
    for(let n = ini; n <= fim; n++){
      if((opts.pular||[]).includes(n)) continue;
      const v = opts.valores && opts.valores[n] != null ? opts.valores[n] : valor;
      out.push({ id:'p'+(++pid), carro, semana:semN(n), valor:v, data:semN(n), forma });
    }
    return out;
  };
  return {
    exemplo:true,
    carros:[
      {id:'c1',placa:'RJK4E21',modelo:'Chevrolet Onix 2019',motorista:'Marcelo Dias',telefone:'(21) 98888-1010',
       valor:520,compra:52000,dia:'Sexta-feira',doc:'Em dia',docVenc:daqui(21),km:118000,obs:'',desde:semN(-30)},
      {id:'c2',placa:'LSQ7B08',modelo:'Hyundai HB20 2018',motorista:'Jefferson Luiz',telefone:'(21) 97777-2020',
       valor:480,compra:46000,dia:'Sábado',doc:'Pendente',docVenc:daqui(-9),km:143500,obs:'Ar-condicionado fraco',desde:semN(-24)},
      {id:'c3',placa:'KPT2H45',modelo:'VW Voyage 2017',motorista:'Rita Almeida',telefone:'(21) 96666-3030',
       valor:450,compra:39000,dia:'Sexta-feira',doc:'Em dia',docVenc:daqui(74),km:167200,obs:'',desde:semN(-34)},
      {id:'c4',placa:'RIO9C63',modelo:'Renault Logan 2020',motorista:'Cleber Santos',telefone:'(21) 95555-4040',
       valor:550,compra:58000,dia:'Segunda-feira',doc:'Em dia',docVenc:daqui(48),km:91000,obs:'',desde:semN(-9)},
      {id:'c5',placa:'GHT8J92',modelo:'Fiat Siena 2015',motorista:'Antônio Ferreira',telefone:'(21) 94444-5050',
       valor:400,compra:31000,dia:'Sexta-feira',doc:'Em dia',docVenc:'',km:198000,obs:'Vendido — carro já rodado demais',
       desde:semN(-46),status:'vendido',vendaData:daqui(-45),vendaValor:23000}
    ],
    pagamentos:[
      // Marcelo (c1): sempre em dia, ~7 meses
      ...semanais('c1',520,'Pix',-30,0),
      // Jefferson (c2): geralmente paga, mas pulou 2 e pagou 1 pela metade — está devendo
      ...semanais('c2',480,'Pix',-24,-1,{pular:[-3], valores:{[-4]:240}}),
      // Rita (c3): em dia, adiantou uma vez, esta semana pagou parcial
      ...semanais('c3',450,'Dinheiro',-34,0,{valores:{[-3]:600, [0]:200}}),
      // Cleber (c4): carro novo (~2 meses), pagou até 2 semanas atrás
      ...semanais('c4',550,'Transferência',-9,-2),
      // Antônio (c5): carro vendido, rodou ~9 meses
      ...semanais('c5',400,'Dinheiro',-46,-7,{pular:[-20,-19]})
    ],
    gastos:[
      {id:'g1',carro:'c1',data:daqui(-86),categoria:'Pneus',descricao:'Quatro pneus novos',
       oficina:'Oficina do Marcos — Méier',km:112000,valor:1200,status:'Concluída',proximo:daqui(279),obs:''},
      {id:'g1b',carro:'c1',data:daqui(-170),categoria:'IPVA / Licenciamento',descricao:'IPVA 2026',
       oficina:'',km:0,valor:1450,status:'Concluída',proximo:daqui(195),obs:''},
      {id:'g2',carro:'c2',data:daqui(-12),categoria:'Manutenção',descricao:'Troca de embreagem',
       oficina:'Auto Center Campo Grande',km:142800,valor:1850,status:'Concluída',proximo:'',obs:'Motorista rodou 3 dias sem o carro'},
      {id:'g3',carro:'c3',data:daqui(-40),categoria:'Revisão',descricao:'Revisão de 160 mil km',
       oficina:'Auto Center Campo Grande',km:160000,valor:640,status:'Concluída',proximo:daqui(5),obs:'Próxima aos 170 mil'},
      {id:'g3b',carro:'c3',data:daqui(-150),categoria:'Seguro',descricao:'Seguro anual',
       oficina:'Corretora Bandeira',km:0,valor:2100,status:'Concluída',proximo:daqui(215),obs:''},
      {id:'g4',carro:'c4',data:daqui(-20),categoria:'Seguro',descricao:'Seguro anual',
       oficina:'Corretora Bandeira',km:82000,valor:2400,status:'Concluída',proximo:daqui(345),obs:''},
      {id:'g5',carro:'c2',data:daqui(3),categoria:'Manutenção',descricao:'Alinhamento e balanceamento',
       oficina:'Oficina do Marcos — Méier',km:0,valor:180,status:'Agendada',proximo:'',obs:''},
      {id:'g6',carro:'c5',data:daqui(-120),categoria:'Manutenção',descricao:'Retífica do motor',
       oficina:'Auto Center Campo Grande',km:190000,valor:3800,status:'Concluída',proximo:'',obs:''},
      {id:'g6b',carro:'c5',data:daqui(-240),categoria:'Pneus',descricao:'Jogo de pneus',
       oficina:'Oficina do Marcos — Méier',km:182000,valor:1100,status:'Concluída',proximo:'',obs:''}
    ],
    indisponibilidades:[
      {id:'i1',carro:'c2',gasto:'g2',inicio:daqui(-13),fim:daqui(-11),suspende:true,obs:'Sem o carro durante a troca de embreagem'}
    ]
  };
}

/* ---------------- cálculos ---------------- */
const carroDe = id => dados.carros.find(c=>c.id===id) || {placa:'—',modelo:'Carro removido'};
/* status do carro: 'ativo' (padrão) ou 'vendido'. Carro antigo sem o campo = ativo. */
const ehVendido = c => c && c.status === 'vendido';
const carrosAtivos = () => dados.carros.filter(c => !ehVendido(c));
const carrosVendidos = () => dados.carros.filter(ehVendido);
const temHistorico = cid => dados.pagamentos.some(p=>p.carro===cid) || dados.gastos.some(g=>g.carro===cid);
const pagoNaSemana = (cid,sem) => dados.pagamentos.filter(p=>p.carro===cid&&p.semana===sem).reduce((t,p)=>t+Number(p.valor),0);
const recebidoTotal = cid => dados.pagamentos.filter(p=>p.carro===cid).reduce((t,p)=>t+Number(p.valor),0);
const gastoTotal = cid => dados.gastos.filter(g=>g.carro===cid&&g.status!=='Agendada').reduce((t,g)=>t+Number(g.valor),0);

/* ---------------- indisponibilidade (carro parado) ---------------- *
 * Cada registro: {id, carro, gasto?, inicio, fim|'', suspende, obs}.
 * fim vazio = ainda parado (conta até hoje). "suspende" = não cobra o
 * aluguel nesses dias. Períodos que se sobrepõem contam cada dia 1× só. */
function indispDoCarro(cid){ return dados.indisponibilidades.filter(x => x.carro === cid && x.inicio); }
function indispAbertaAgora(cid){
  // "na oficina agora" = sem data de volta, ou volta marcada pra depois de hoje.
  // Volta marcada pra hoje/ontem = carro já voltou, não aparece mais como parado.
  const h = hoje();
  return indispDoCarro(cid).find(x => x.inicio <= h && (!x.fim || x.fim > h));
}
/* dias da semana [semSeg..+6] cobertos por indisponibilidade COM suspensão */
function diasSuspensosNaSemana(cid, semSeg){
  const fimSem = addDias(semSeg, 6), h = hoje();
  const dias = new Set();
  indispDoCarro(cid).filter(x => x.suspende).forEach(x => {
    let d = x.inicio > semSeg ? x.inicio : semSeg;
    const ate = (x.fim || h) < fimSem ? (x.fim || h) : fimSem;
    while(d <= ate){ dias.add(d); d = addDias(d, 1); }
  });
  return dias.size;   // 0..7
}
function esperadoNaSemana(carro, sem){
  const dias = diasSuspensosNaSemana(carro.id, sem);
  return { esperado: Math.round(Number(carro.valor||0) * (7 - dias) / 7), diasSusp: dias };
}

function situacao(carro, sem){
  const pago = pagoNaSemana(carro.id, sem);
  const { esperado, diasSusp } = esperadoNaSemana(carro, sem);
  const passada = sem < iso(segundaDe(new Date()));
  if(esperado === 0) return {tipo:'pago', texto:'Não cobra', pago, esperado, diasSusp};
  if(pago >= esperado) return {tipo:'pago', texto:'Pago', pago, esperado, diasSusp};
  if(pago > 0) return {tipo:passada?'atr':'pend', texto:`Falta ${moeda(esperado-pago)}`, pago, esperado, diasSusp};
  return {tipo:passada?'atr':'pend', texto:passada?'Não pagou':'A receber', pago, esperado, diasSusp};
}

/* ---------------- caderneta (dívida acumulada) ---------------- *
 * Soma o que cada motorista devia ter pago (uma semana de aluguel por
 * semana, desde que o aluguel começou) menos o que realmente pagou.
 * A semana atual não entra — só semanas já fechadas. Pagar a mais numa
 * semana abate a dívida das outras (pode ficar "adiantado"). */
function inicioCobranca(carro){
  if(carro.desde) return segundaDe(new Date(carro.desde + 'T12:00'));
  const pagas = dados.pagamentos.filter(p => p.carro === carro.id).map(p => p.semana).sort();
  if(pagas.length) return segundaDe(new Date(pagas[0] + 'T12:00'));
  return segundaDe(new Date());
}
function fimCobranca(carro){
  // carro vendido: a caderneta congela na semana da venda
  if(ehVendido(carro) && carro.vendaData) return segundaDe(new Date(carro.vendaData + 'T12:00'));
  return segundaDe(new Date());                   // senão, até a semana passada (a atual fica de fora)
}
function semanasCobranca(carro){
  const fim = fimCobranca(carro);
  const out = [];
  for(let d = inicioCobranca(carro); d < fim; d.setDate(d.getDate() + 7)) out.push(iso(new Date(d)));
  return out.slice(-104);                         // trava: no máximo 2 anos pra trás
}
function caderneta(carro){
  const valor = Number(carro.valor) || 0;
  const semanas = semanasCobranca(carro).map(s => {
    const pago = pagoNaSemana(carro.id, s);
    const { esperado, diasSusp } = esperadoNaSemana(carro, s);
    return { semana:s, pago, diasSusp, valorCheio: valor, esperadoSemana: esperado, falta: esperado - pago };
  });
  const esperado = semanas.reduce((t, x) => t + x.esperadoSemana, 0);
  const pago = semanas.reduce((t, x) => t + x.pago, 0);
  return { semanas, esperado, pago, saldo: esperado - pago };
}

/* ---------------- economia do carro ---------------- *
 * resultado operacional = aluguel recebido − gastos (manutenção, pneus,
 * seguro, IPVA, multas...). Payback: quantos meses faltam pra esse
 * resultado igualar o preço de compra. Rendimento anual: resultado
 * mensal médio × 12 ÷ preço de compra. NÃO conta a desvalorização. */
function economia(carro){
  const receita = recebidoTotal(carro.id);
  const despesas = gastoTotal(carro.id);
  const resultadoOp = receita - despesas;
  const compra = Number(carro.compra || 0);
  const meses = Math.max((fimCobranca(carro) - inicioCobranca(carro)) / 86400000 / 30.44, 0.1);
  const opMensal = resultadoOp / meses;
  const pct = compra ? Math.min(Math.max(resultadoOp / compra, 0), 1) * 100 : 0;
  const falta = compra - resultadoOp;
  const paybackMeses = (falta > 0 && opMensal > 0) ? Math.ceil(falta / opMensal) : 0;
  const rendAnual = compra ? Math.round((opMensal * 12) / compra * 100) : null;
  const maduro = meses >= 3 && compra > 0;
  return { receita, despesas, resultadoOp, compra, meses, opMensal, pct, falta, paybackMeses, rendAnual, maduro };
}
function rendimentoFrota(){
  const mad = carrosAtivos().map(economia).filter(e => e.maduro);
  const capital = mad.reduce((t,e)=>t+e.compra, 0);
  const opAnual = mad.reduce((t,e)=>t+e.opMensal*12, 0);
  return capital ? Math.round(opAnual / capital * 100) : null;
}
function paybackTexto(meses){
  if(meses > 60) return 'mais de 5 anos';
  if(meses < 12) return meses + (meses === 1 ? ' mês' : ' meses');
  const anos = Math.floor(meses/12), resto = Math.round(meses%12);
  return anos + (anos===1?' ano':' anos') + (resto ? ` e ${resto} ${resto===1?'mês':'meses'}` : '');
}

/* vencimentos: documentação de cada carro + gastos com data de próximo vencimento */
function vencimentos(limiteDias = 30){
  const lista = [];
  carrosAtivos().forEach(c=>{
    if(c.docVenc) lista.push({carro:c.id, quando:c.docVenc, titulo:'Documentação do veículo',
      detalhe:c.doc==='Pendente'?'Marcada como pendente':'Licenciamento / IPVA'});
  });
  dados.gastos.forEach(g=>{
    if(g.proximo && !ehVendido(carroDe(g.carro))) lista.push({carro:g.carro, quando:g.proximo, titulo:g.categoria, detalhe:g.descricao});
  });
  return lista.filter(v=>diasAte(v.quando) <= limiteDias).sort((a,b)=>a.quando.localeCompare(b.quando));
}

/* ---------------- render ----------------
 * irAoTopo: só rola pro topo quando muda de aba/semana. Num lançamento
 * (pagamento, gasto, desfazer) a tela fica onde estava. */
function render(irAoTopo){
  const sem = iso(semanaAtiva());
  $('semTitulo').textContent = rotuloSemana(semanaAtiva());
  $('semRotulo').textContent = offsetSemana===0?'Semana atual':offsetSemana===-1?'Semana passada'
    : offsetSemana<0?`${-offsetSemana} semanas atrás`:'Semana que vem';
  $('semProx').disabled = offsetSemana>=0;
  const topo = aba==='semana';
  document.querySelector('header').classList.toggle('oculto', !topo);
  $('resumo').classList.toggle('oculto', !topo);

  if(aba==='semana') telaSemana(sem);
  if(aba==='carros') telaCarros();
  if(aba==='manutencao') telaManutencao();
  if(aba==='balanco') telaBalanco();
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('ativo', b.dataset.aba===aba));
  if(irAoTopo) window.scrollTo(0,0);
}

const bannerExemplo = () => `<div class="aviso"><span>Estes carros são só exemplo.</span>
  <button onclick="limparExemplo()">Limpar e começar do zero</button></div>`;

function voltarHoje(){ offsetSemana = 0; render(true); }

/* Carros cujo dia de pagamento é hoje e que ainda não quitaram esta semana.
   (não conta os que estão parados na oficina com cobrança suspensa) */
function motoristasDeHoje(sem){
  if(offsetSemana !== 0) return [];
  const nomeHoje = new Date().toLocaleDateString('pt-BR', { weekday:'long' }).toLowerCase();
  return carrosAtivos().filter(c => {
    const ind = indispAbertaAgora(c.id);
    if(ind && ind.suspende) return false;
    return (c.dia || '').toLowerCase() === nomeHoje &&
      pagoNaSemana(c.id, sem) < esperadoNaSemana(c, sem).esperado;
  });
}
function textoNaOficina(ind){
  const dias = -diasAte(ind.inicio);   // dias desde que entrou
  const q = dias <= 0 ? 'desde hoje' : dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
  return `Na oficina ${q}${ind.suspende?' · sem cobrança':''}`;
}

function telaSemana(sem){
  const ativos = carrosAtivos();
  const naSemana = c => {
    const ind = offsetSemana===0 ? indispAbertaAgora(c.id) : null;
    return { esp: esperadoNaSemana(c, sem).esperado, pago: pagoNaSemana(c.id, sem), oficina: ind && ind.suspende ? ind : null };
  };
  let total = 0, receb = 0;
  ativos.forEach(c => { const x = naSemana(c); if(x.oficina) return; total += x.esp; receb += Math.min(x.pago, x.esp); });
  $('resumo').innerHTML = `
    <div><span>Recebido</span><strong class="v-pago">${moeda(receb)}</strong></div>
    <div><span>Falta receber</span><strong class="v-falta">${moeda(Math.max(total-receb,0))}</strong></div>`;

  if(!ativos.length){
    $('conteudo').innerHTML = `<div class="vazio"><p>Nenhum carro na frota.</p>
      <button class="btn" onclick="formCarro()">Cadastrar carro</button></div>`;
    return;
  }
  const venc = vencimentos(7);   // aqui só o urgente; o panorama de 30 dias fica na aba Manutenção
  const ordem = {atr:0,pend:1,pago:2};
  const lista = [...ativos].sort((a,b)=>ordem[situacao(a,sem).tipo]-ordem[situacao(b,sem).tipo]);
  const hoje_ = motoristasDeHoje(sem);
  const naOficina = offsetSemana===0
    ? ativos.map(c => ({ c, ind: indispAbertaAgora(c.id) })).filter(x => x.ind) : [];
  const devendo = ativos
    .map(c => ({ c, cad: caderneta(c) }))
    .filter(x => x.cad.saldo > 0)
    .sort((a,b) => b.cad.saldo - a.cad.saldo);

  const cardCarro = (c, sem) => {
    const s = situacao(c,sem);
    const ind = offsetSemana===0 ? indispAbertaAgora(c.id) : null;
    const falta = Math.max(s.esperado - s.pago, 0);
    return `<article class="carro">
      <div class="placa"><i>BRASIL</i><b>${esc(c.placa)}</b></div>
      <div class="modelo">${esc(c.modelo)}</div>
      <div class="motorista">${esc(c.motorista||'Sem motorista')} · paga ${esc(c.dia||'—')}</div>
      <div class="rodape">
        ${ind && ind.suspende
          ? `<span class="selo s-pend">🔧 ${esc(textoNaOficina(ind))}</span>`
          : `<span class="selo s-${s.tipo}">${s.texto}</span>` +
            (s.diasSusp>0 && s.esperado>0 ? ` <small class="motorista">(${s.diasSusp} dia${s.diasSusp>1?'s':''} parado)</small>` : '')}
        <span class="cresce"></span>
        ${(ind && ind.suspende) || s.tipo==='pago'
          ? (s.tipo==='pago' && !(ind && ind.suspende) ? `<span class="num v-pago">${moeda(s.pago)}</span>` : '')
          : `<button class="btn-vazio" onclick="formPagamento('${c.id}')">Outro valor</button>
             <button class="btn" onclick="pagarTudo('${c.id}')">Pagou ${moeda(falta)}</button>`}
      </div>
    </article>`;
  };

  $('conteudo').innerHTML = (dados.exemplo?bannerExemplo():'')
    + (offsetSemana!==0
        ? `<button class="btn-vazio btn-largo" onclick="voltarHoje()">← Voltar pra semana de hoje</button>` : '')
    + (naOficina.length
        ? `<h3 class="sec">Na oficina</h3>` + naOficina.map(({c, ind}) => `<div class="alerta" style="display:block">
            <strong>${esc(c.placa)} · ${esc(c.motorista||'sem motorista')}</strong>
            <small style="display:block;color:var(--media)">${esc(textoNaOficina(ind))}${ind.suspende?` desde ${dataBR(ind.inicio)}`:''}</small>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn-vazio" onclick="verCarro('${c.id}')">Ver</button>
              <button class="btn" onclick="carroVoltou('${ind.id}')">Carro voltou</button>
            </div>
          </div>`).join('') : '')
    + (hoje_.length
        ? `<h3 class="sec">Hoje</h3>` + hoje_.map(c => cardCarro(c, sem)).join('') : '')
    + (venc.length ? `<h3 class="sec">Precisa de atenção</h3>` + venc.map(v=>{
        const d = diasAte(v.quando), c = carroDe(v.carro);
        return `<div class="alerta ${d<0?'venceu':''}">
          <div><strong>${esc(c.placa)} · ${esc(v.titulo)}</strong>
          <small>${esc(v.detalhe)} — ${d<0?`venceu há ${-d} dia${-d>1?'s':''}`:d===0?'vence hoje':`vence em ${d} dia${d>1?'s':''}`}</small></div>
        </div>`;
      }).join('') : '')
    + (devendo.length
        ? `<h3 class="sec">Devendo de semanas passadas</h3>` + devendo.map(({c, cad}) => {
            const nSem = cad.semanas.filter(x => x.falta > 0).length;
            return `<div class="item">
              <div><strong>${esc(c.motorista||'Sem motorista')} · ${esc(c.placa)}</strong>
                <small>${nSem} semana${nSem>1?'s':''} em aberto</small></div>
              <div class="dir"><b class="num v-atr">${moeda(cad.saldo)}</b>
                <small><button class="apagar" style="text-decoration:underline" onclick="verCarro('${c.id}')">ver</button></small></div>
            </div>`;
          }).join('') : '')
    + `<h3 class="sec">Aluguel da semana</h3>`
    + lista.map(c => cardCarro(c, sem)).join('');
}

let vendidosAbertos = false;
function alternarVendidos(){ vendidosAbertos = !vendidosAbertos; render(); }

function telaCarros(){
  const ativos = carrosAtivos(), vendidos = carrosVendidos();

  const cardAtivo = c => {
    const saldo = caderneta(c).saldo;
    const ind = indispAbertaAgora(c.id);
    return `<article class="carro">
      <div class="placa"><i>BRASIL</i><b>${esc(c.placa)}</b></div>
      <div class="modelo">${esc(c.modelo)}</div>
      <div class="motorista">${esc(c.motorista||'Sem motorista')}${c.telefone?' · '+esc(c.telefone):''}</div>
      <div class="rodape">
        <span class="num">${moeda(c.valor)}</span><span class="motorista">por semana</span>
        <span class="cresce"></span>
        ${ind ? `<span class="selo s-pend">🔧 Na oficina</span>` : ''}
        ${saldo > 0 ? `<span class="selo s-atr">Devendo ${moeda(saldo)}</span>`
          : saldo < 0 ? `<span class="selo s-pago">Adiantado ${moeda(-saldo)}</span>` : ''}
        ${c.doc==='Pendente'?`<span class="selo s-atr">Documentação pendente</span>`:''}
        <button class="btn-vazio" onclick="verCarro('${c.id}')">Ver</button>
      </div>
    </article>`;
  };
  const cardVendido = c => `<article class="carro">
      <div class="placa"><i>BRASIL</i><b>${esc(c.placa)}</b></div>
      <div class="modelo">${esc(c.modelo)}</div>
      <div class="motorista">Vendido em ${dataBR(c.vendaData)}${Number(c.vendaValor)?' por '+moeda(c.vendaValor):''}</div>
      <div class="rodape">
        <span class="cresce"></span>
        <button class="btn-vazio" onclick="verCarro('${c.id}')">Ver histórico</button>
      </div>
    </article>`;

  $('conteudo').innerHTML = `<h2>Carros da frota</h2>`
    + (dados.exemplo?bannerExemplo():'')
    + `<button class="btn btn-largo" onclick="formCarro()">Adicionar carro</button>`
    + (ativos.length ? ativos.map(cardAtivo).join('')
        : `<div class="vazio"><p>Nenhum carro na frota.</p></div>`)
    + (vendidos.length
        ? `<button class="btn-vazio btn-largo" style="margin-top:6px" onclick="alternarVendidos()">
             Vendidos (${vendidos.length}) ${vendidosAbertos?'▲':'▼'}</button>`
          + (vendidosAbertos ? vendidos.map(cardVendido).join('') : '')
        : '');
}

function telaManutencao(){
  const agendados = dados.gastos.filter(g=>g.status!=='Concluída').sort((a,b)=>a.data.localeCompare(b.data));
  const feitos = dados.gastos.filter(g=>g.status==='Concluída').sort((a,b)=>b.data.localeCompare(a.data));
  const mesAtual = hoje().slice(0,7);
  const noMes = dados.gastos.filter(g=>g.status==='Concluída' && g.data.startsWith(mesAtual))
                            .reduce((t,g)=>t+Number(g.valor),0);
  const venc = vencimentos();

  const linha = g => `<div class="item">
      <div><strong>${esc(carroDe(g.carro).placa)} · ${esc(g.categoria)}</strong>
        <small>${esc(g.descricao||'')}${g.oficina?' — '+esc(g.oficina):''}</small>
        <small>${dataBR(g.data)}${g.km?' · '+Number(g.km).toLocaleString('pt-BR')+' km':''}${g.proximo?' · próxima em '+dataBR(g.proximo):''}</small>
      </div>
      <div class="dir"><b class="num">${moeda(g.valor)}</b>
        <small><button class="apagar" onclick="apagarGasto('${g.id}')">Excluir</button></small></div>
    </div>`;

  $('conteudo').innerHTML = `<h2>Manutenção e gastos</h2>`
    + `<div class="resumo" style="margin:0 0 14px">
         <div><span>Gasto neste mês</span><strong class="v-atr">${moeda(noMes)}</strong></div>
         <div><span>Serviços em aberto</span><strong>${agendados.length}</strong></div>
       </div>`
    + `<button class="btn btn-largo" onclick="formGasto()">Lançar gasto ou serviço</button>`
    + (venc.length ? `<h3 class="sec">A vencer nos próximos 30 dias</h3>` + venc.map(v=>{
        const d = diasAte(v.quando);
        return `<div class="alerta ${d<0?'venceu':''}"><div>
          <strong>${esc(carroDe(v.carro).placa)} · ${esc(v.titulo)}</strong>
          <small>${esc(v.detalhe)} — ${dataBR(v.quando)}</small></div></div>`;
      }).join('') : '')
    + (agendados.length ? `<h3 class="sec">Agendado ou pendente</h3>`+agendados.map(linha).join('') : '')
    + (feitos.length ? `<h3 class="sec">Já feito</h3>`+feitos.map(linha).join('')
      : (agendados.length?'':`<div class="vazio"><p>Nenhum gasto lançado ainda. Cada serviço que você lançar entra no balanço do carro.</p></div>`));
}

function telaBalanco(){
  const tot = {compra:0, compraAtiva:0, receb:0, gasto:0, vendas:0};

  const linhaVal = (rot, val, cls) => `<span><span class="motorista">${rot}</span> <b class="num ${cls||''}">${val}</b></span>`;

  const cardAtivo = c => {
    const e = economia(c);
    return `<article class="carro">
      <div class="placa"><i>BRASIL</i><b>${esc(c.placa)}</b></div>
      <div class="modelo">${esc(c.modelo)}</div>
      <div class="motorista">Comprado por ${e.compra?moeda(e.compra):'valor não informado'}</div>
      <div class="rodape" style="display:block">
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px">
          ${linhaVal('Rendeu de aluguel', moeda(e.receita), 'v-pago')}
          ${linhaVal('Gastou', moeda(e.despesas), 'v-atr')}
          ${linhaVal('Sobrou', (e.resultadoOp>=0?'+':'')+moeda(e.resultadoOp), e.resultadoOp>=0?'v-pago':'v-atr')}
        </div>
        ${e.compra ? `<div class="barra"><i style="width:${e.pct}%"></i></div>
          <div class="motorista">${e.falta<=0
            ? `Já se pagou — ${moeda(-e.falta)} acima da compra`
            : `Recuperou ${Math.round(e.pct)}% dos ${moeda(e.compra)}` +
              (e.maduro && e.paybackMeses ? ` · falta ~${paybackTexto(e.paybackMeses)}` : '')}</div>
          <div class="motorista" style="margin-top:4px">Rendimento: ${e.maduro
            ? `<b class="${e.rendAnual>=0?'v-pago':'v-atr'}">${e.rendAnual>=0?'+':''}${e.rendAnual}% ao ano</b> <sup>*</sup>`
            : 'ainda cedo pra calcular (menos de 3 meses)'}</div>` : ''}
      </div>
    </article>`;
  };
  const cardVendido = c => {
    const e = economia(c);
    const compra = e.compra, venda = Number(c.vendaValor||0);
    const resultado = e.receita + venda - e.despesas - compra;
    const pctCompra = compra ? Math.round(resultado / compra * 100) : null;
    return `<article class="carro">
      <div class="placa"><i>BRASIL</i><b>${esc(c.placa)}</b></div>
      <div class="modelo">${esc(c.modelo)}</div>
      <div class="motorista">Vendido em ${dataBR(c.vendaData)}${venda?' por '+moeda(venda):''}</div>
      <div class="rodape" style="display:block">
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          ${linhaVal('Aluguel', moeda(e.receita), 'v-pago')}
          ${linhaVal('Gastos', moeda(e.despesas), 'v-atr')}
          ${linhaVal('Compra', compra?moeda(compra):'—')}
        </div>
        <div class="motorista" style="margin-top:8px">Resultado final:
          <b class="num ${resultado>=0?'v-pago':'v-atr'}">${resultado>=0?'+':''}${moeda(resultado)}</b>
          ${pctCompra!=null ? ` <span class="motorista">(${pctCompra>=0?'+':''}${pctCompra}% sobre a compra, em ${Math.round(e.meses)} ${Math.round(e.meses)===1?'mês':'meses'})</span>` : ''}</div>
      </div>
    </article>`;
  };

  let resVendidos = 0;
  dados.carros.forEach(c => {
    const compra = Number(c.compra||0), r = recebidoTotal(c.id), g = gastoTotal(c.id);
    if(!ehVendido(c)) tot.compraAtiva += compra;
    else resVendidos += r + Number(c.vendaValor||0) - g - compra;
    tot.receb += r;
    tot.gasto += g;
    tot.vendas += Number(c.vendaValor||0);
  });
  const ativos = carrosAtivos(), vendidos = carrosVendidos();
  const operacional = tot.receb - tot.gasto;
  const rendFrota = rendimentoFrota();

  $('conteudo').innerHTML = `<h2>Balanço da frota</h2>`
    + `<div class="resumo" style="margin:0 0 6px">
        <div><span>Recebido de aluguel</span><strong class="v-pago">${moeda(tot.receb)}</strong></div>
        <div><span>Gasto com a frota</span><strong class="v-atr">${moeda(tot.gasto)}</strong></div>
       </div>
       <div class="resumo" style="margin:0 0 6px">
        <div><span>Aluguel menos gastos</span><strong class="${operacional>=0?'v-pago':'v-atr'}">${operacional>=0?'+':''}${moeda(operacional)}</strong></div>
        <div><span>Investido na frota atual</span><strong>${moeda(tot.compraAtiva)}</strong></div>
       </div>
       <div class="resumo" style="margin:0 0 4px">
        <div><span>Rendimento da frota</span><strong class="${rendFrota==null?'':(rendFrota>=0?'v-pago':'v-atr')}">${rendFrota==null?'—':`${rendFrota>=0?'+':''}${rendFrota}% ao ano`}</strong></div>
        ${vendidos.length ? `<div><span>Resultado dos vendidos</span><strong class="${resVendidos>=0?'v-pago':'v-atr'}">${resVendidos>=0?'+':''}${moeda(resVendidos)}</strong></div>` : ''}
       </div>
       <p class="motorista" style="font-size:13px;margin:0 0 14px">* o rendimento não conta a desvalorização do carro — o número real é um pouco menor.</p>`
    + (ativos.length ? ativos.map(cardAtivo).join('')
        : (vendidos.length ? '' : `<div class="vazio"><p>Cadastre os carros com o valor de compra pra acompanhar quando cada um se paga.</p></div>`))
    + (vendidos.length ? `<h3 class="sec">Vendidos</h3>` + vendidos.map(cardVendido).join('') : '');
}

/* ---------------- painéis ---------------- */
function abrir(html){ $('painel').innerHTML = html; $('painel').classList.add('aberto'); $('fundo').classList.add('aberto'); }
function fechar(){ $('painel').classList.remove('aberto'); $('fundo').classList.remove('aberto'); }
$('fundo').onclick = fechar;

function verCarro(cid){
  const c = carroDe(cid);
  const pags = dados.pagamentos.filter(p=>p.carro===cid).sort((a,b)=>b.data.localeCompare(a.data)).slice(0,5);
  const gs = dados.gastos.filter(g=>g.carro===cid).sort((a,b)=>b.data.localeCompare(a.data)).slice(0,5);
  const vendido = ehVendido(c);
  const indAberta = indispAbertaAgora(cid);
  const paradas = indispDoCarro(cid).slice().sort((a,b)=>b.inicio.localeCompare(a.inicio));
  const cad = caderneta(c);
  const recentes = cad.semanas.slice(-8).reverse();
  const rotSit = vendido ? { atr:'Ficou devendo', ok:'Ficou quitado', ad:'Ficou adiantado' }
                         : { atr:'Devendo', ok:'Em dia', ad:'Adiantado' };
  const cadResumo = cad.saldo > 0 ? `<strong class="v-atr">${rotSit.atr} ${moeda(cad.saldo)}</strong>`
    : cad.saldo < 0 ? `<strong class="v-pago">${rotSit.ad} ${moeda(-cad.saldo)}</strong>`
    : `<strong class="v-pago">${rotSit.ok}</strong>`;
  abrir(`<h3>${esc(c.placa)}</h3>
    <p class="sub">${esc(c.modelo)} · ${esc(c.motorista||'sem motorista')}${c.telefone?' · '+esc(c.telefone):''}</p>
    ${vendido ? `<div class="aviso" style="background:var(--pago-f);margin:0 0 12px">
      Vendido em ${dataBR(c.vendaData)}${Number(c.vendaValor)?' por '+moeda(c.vendaValor):''}</div>` : ''}
    ${indAberta && !vendido ? `<div class="aviso" style="margin:0 0 12px;flex-wrap:nowrap">
      <span>🔧 ${esc(textoNaOficina(indAberta))} (desde ${dataBR(indAberta.inicio)})</span>
      <button onclick="carroVoltou('${indAberta.id}')">Carro voltou</button></div>` : ''}
    <div class="resumo" style="margin:12px 0">
      <div><span>Recebeu</span><strong class="v-pago">${moeda(recebidoTotal(cid))}</strong></div>
      <div><span>Gastou</span><strong class="v-atr">${moeda(gastoTotal(cid))}</strong></div>
    </div>
    <h3 class="sec">Caderneta</h3>
    <div class="resumo" style="margin:0 0 10px">
      <div><span>Situação</span>${cadResumo}</div>
      <div><span>Semanas contadas</span><strong>${cad.semanas.length}</strong></div>
    </div>
    ${recentes.length ? recentes.map(x => {
      const quitado = x.falta <= 0;
      const nota = x.diasSusp > 0
        ? `${x.diasSusp} dia${x.diasSusp>1?'s':''} parado · cobra ${moeda(x.esperadoSemana)} (não ${moeda(x.valorCheio)})`
        : (quitado ? 'Pago ' + moeda(x.pago) : x.pago > 0 ? 'Pagou ' + moeda(x.pago) + ' — falta ' + moeda(x.falta) : 'Não pagou');
      return `<div class="item">
        <div><strong>${dataBR(x.semana)}</strong><small>${nota}</small></div>
        <div class="dir">${x.esperadoSemana === 0
          ? '<b class="num motorista">—</b>'
          : quitado ? '<b class="num v-pago">✓</b>'
          : vendido ? `<b class="num v-atr">${moeda(x.falta)}</b>`
          : `<button class="btn" onclick="formPagamento('${cid}','${x.semana}')">Receber</button>`}</div>
      </div>`;
    }).join('') : `<p class="motorista" style="margin:0 0 8px">Ainda não há semanas fechadas pra cobrar.</p>`}
    <div class="motorista">Aluguel de ${moeda(c.valor)} por semana, vence ${esc(c.dia||'—')}.
      Documentação: ${esc(c.doc||'—')}${c.docVenc?' até '+dataBR(c.docVenc):''}.
      ${c.km?'Último km anotado: '+Number(c.km).toLocaleString('pt-BR')+'.':''}</div>
    ${c.obs?`<div class="aviso" style="margin-top:12px">${esc(c.obs)}</div>`:''}
    ${pags.length?`<h3 class="sec">Últimos pagamentos</h3>`+pags.map(p=>`<div class="item">
      <div><strong>${moeda(p.valor)}</strong><small>${dataBR(p.data)} · ${esc(p.forma)}</small></div>
      <div class="dir"><button class="apagar" onclick="apagarPagamento('${p.id}')">Excluir</button></div></div>`).join(''):''}
    ${gs.length?`<h3 class="sec">Últimos gastos</h3>`+gs.map(g=>`<div class="item">
      <div><strong>${esc(g.categoria)}</strong><small>${esc(g.descricao||'')} · ${dataBR(g.data)}</small></div>
      <div class="dir"><b class="num">${moeda(g.valor)}</b></div></div>`).join(''):''}
    ${paradas.length?`<h3 class="sec">Períodos parado</h3>`+paradas.map(x=>`<div class="item">
      <div><strong>${dataBR(x.inicio)} ${x.fim?'a '+dataBR(x.fim):'— ainda parado'}</strong>
        <small>${x.suspende?'sem cobrança':'cobrança normal'}${x.obs?' · '+esc(x.obs):''}</small></div>
      <div class="dir"><button class="apagar" onclick="apagarParada('${x.id}')">Excluir</button></div></div>`).join(''):''}
    <div class="acoes">
      <button class="btn-vazio" onclick="formCarro('${cid}')">Editar carro</button>
      ${vendido
        ? `<button class="btn" onclick="reativarCarro('${cid}')">Reativar carro</button>`
        : `<button class="btn" onclick="formGasto(null,'${cid}')">Lançar gasto</button>`}
    </div>
    ${vendido ? '' : `<div style="text-align:center;margin-top:16px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
      <button class="apagar" onclick="formParada('${cid}')">Registrar carro parado</button>
      <button class="apagar" onclick="formVenda('${cid}')">Marcar como vendido</button></div>`}
    <div style="text-align:center;margin-top:14px"><button class="btn-vazio" style="border:none" onclick="fechar()">Fechar</button></div>`);
}

function formVenda(cid){
  const c = carroDe(cid);
  abrir(`<h3>Vender ${esc(c.placa)}</h3>
    <p class="sub">O carro sai do dia a dia, mas todo o histórico fica guardado.</p>
    <div class="dupla">
      <div><label for="vd">Data da venda</label><input id="vd" type="date" value="${hoje()}"></div>
      <div><label for="vv">Valor da venda (R$)</label><input id="vv" type="number" step="100" placeholder="opcional"></div>
    </div>
    <div class="acoes">
      <button class="btn-vazio" onclick="verCarro('${cid}')">Cancelar</button>
      <button class="btn" onclick="salvarVenda('${cid}')">Confirmar venda</button>
    </div>`);
}
async function salvarVenda(cid){
  const carro = dados.carros.find(c=>c.id===cid);
  if(!carro) return;
  const data = $('vd').value || hoje();
  const anterior = { status: carro.status, vendaData: carro.vendaData, vendaValor: carro.vendaValor };
  carro.status = 'vendido';
  carro.vendaData = data;
  carro.vendaValor = Number($('vv').value) || 0;
  await salvar(); fechar(); render();
  avisoDesfazer(`${carro.placa} marcado como vendido`, async () => {
    Object.assign(carro, anterior);
    await salvar(); render(); aviso('Desfeito');
  });
}
async function reativarCarro(cid){
  const carro = dados.carros.find(c=>c.id===cid);
  if(!carro) return;
  const anterior = { status: carro.status, vendaData: carro.vendaData, vendaValor: carro.vendaValor };
  carro.status = 'ativo';
  delete carro.vendaData; delete carro.vendaValor;
  await salvar(); fechar(); render();
  avisoDesfazer(`${carro.placa} de volta na frota`, async () => {
    Object.assign(carro, anterior);
    await salvar(); render(); aviso('Desfeito');
  });
}

/* ---------------- carro parado (indisponibilidade) ---------------- */
function formParada(cid, gid, ini){
  const c = carroDe(cid);
  const existente = gid ? dados.indisponibilidades.find(x => x.gasto === gid) : null;
  const x = existente || { inicio: ini || hoje(), fim:'', suspende:true, obs:'' };
  abrir(`<h3>Carro parado — ${esc(c.placa)}</h3>
    <p class="sub">Dias parados com cobrança suspensa não entram na caderneta do motorista.</p>
    <div class="dupla">
      <div><label for="pi">Parado desde</label><input id="pi" type="date" value="${x.inicio||''}"></div>
      <div><label for="pf2">Voltou em</label><input id="pf2" type="date" value="${x.fim||''}"></div>
    </div>
    <small class="motorista" style="display:block;margin-top:4px">Deixe "Voltou em" em branco enquanto o carro ainda estiver na oficina.</small>
    <label style="display:flex;align-items:center;gap:8px;margin-top:14px;font-weight:600">
      <input type="checkbox" id="ps" ${x.suspende?'checked':''} style="width:auto"> Não cobrar o aluguel nesses dias</label>
    <label for="pob">Observação</label><input id="pob" value="${esc(x.obs||'')}" placeholder="Motor fundido, aguardando peça...">
    <div class="acoes">
      <button class="btn-vazio" onclick="verCarro('${cid}')">Cancelar</button>
      <button class="btn" onclick="salvarParada('${cid}',${gid?`'${gid}'`:'null'},${existente?`'${existente.id}'`:'null'})">Salvar</button>
    </div>`);
}
async function salvarParada(cid, gid, id){
  const inicio = $('pi').value;
  if(!inicio) return aviso('Preencha a data de início.');
  const fim = $('pf2').value || '';
  if(fim && fim < inicio) return aviso('A volta não pode ser antes do início.');
  const dados_ = { carro:cid, gasto: gid || null, inicio, fim, suspende: $('ps').checked, obs: $('pob').value.trim() };
  const alvo = id ? dados.indisponibilidades.find(x=>x.id===id) : null;
  if(alvo) Object.assign(alvo, dados_);
  else dados.indisponibilidades.push({ id:novoId(), ...dados_ });
  await salvar(); fechar(); render(); aviso('Período registrado');
}
async function carroVoltou(id){
  const x = dados.indisponibilidades.find(y=>y.id===id);
  if(!x) return;
  const ontem = addDias(hoje(), -1);
  if(ontem < x.inicio){
    // entrou e voltou no mesmo dia — não houve dia parado, some o registro
    const copia = clonar(x);
    dados.indisponibilidades = dados.indisponibilidades.filter(y=>y.id!==id);
    await salvar(); fechar(); render();
    avisoDesfazer('Carro de volta', async () => {
      dados.indisponibilidades.push(copia); await salvar(); render(); aviso('Desfeito');
    });
    return;
  }
  const antes = x.fim;
  x.fim = ontem;                       // último dia parado = ontem (voltou hoje)
  await salvar(); fechar(); render();
  avisoDesfazer('Carro de volta', async () => { x.fim = antes; await salvar(); render(); aviso('Desfeito'); });
}
function apagarParada(id){
  confirmar('O período parado sai do registro e a caderneta volta a cobrar essas semanas normalmente.','Excluir período', async () => {
    dados.indisponibilidades = dados.indisponibilidades.filter(x => x.id !== id);
    await salvar(); fechar(); render(); aviso('Período excluído');
  });
}

function formPagamento(cid, semArg){
  const c = carroDe(cid);
  const sem = semArg || iso(semanaAtiva());
  const segDaSem = semArg ? new Date(semArg + 'T12:00') : semanaAtiva();
  const { esperado, diasSusp } = esperadoNaSemana(c, sem);
  const falta = Math.max(esperado - pagoNaSemana(cid,sem), 0);
  abrir(`<h3>${esc(c.placa)} · ${esc(c.motorista||'sem motorista')}</h3>
    <p class="sub">Semana de ${rotuloSemana(segDaSem)}${diasSusp>0?` · ${diasSusp} dia${diasSusp>1?'s':''} parado (esperado ${moeda(esperado)})`:''}</p>
    <label for="pv">Quanto ele pagou</label>
    <input id="pv" type="number" inputmode="decimal" step="0.01" value="${falta}">
    <div class="dupla">
      <div><label for="pf">Como pagou</label>
        <select id="pf">${['Pix','Dinheiro','Transferência','Cartão'].map(o=>`<option ${o===formaHabitual(cid)?'selected':''}>${o}</option>`).join('')}</select></div>
      <div><label for="pd">Dia</label><input id="pd" type="date" value="${hoje()}"></div>
    </div>
    <div class="acoes">
      <button class="btn-vazio" onclick="fechar()">Cancelar</button>
      <button class="btn" onclick="salvarPagamento('${cid}','${sem}')">Registrar pagamento</button>
    </div>`);
  setTimeout(()=>$('pv').select(),120);
}
async function salvarPagamento(cid,sem){
  const valor = Number($('pv').value);
  if(!valor||valor<=0) return aviso('Digite um valor maior que zero.');
  const id = novoId();
  dados.pagamentos.push({id,carro:cid,semana:sem,valor,data:$('pd').value,forma:$('pf').value});
  await salvar(); fechar(); render();
  avisoDesfazer('Pagamento registrado', () => desfazerPagamento(id));
}

/* forma de pagamento mais usada recentemente por esse carro (pra pré-selecionar) */
function formaHabitual(cid){
  const p = dados.pagamentos.filter(x=>x.carro===cid).sort((a,b)=>b.data.localeCompare(a.data))[0];
  return (p && p.forma) || 'Pix';
}

/* Um toque: lança o que falta da semana atual, com a data de hoje. */
async function pagarTudo(cid){
  const c = carroDe(cid), sem = iso(semanaAtiva());
  const falta = Math.max(esperadoNaSemana(c, sem).esperado - pagoNaSemana(cid, sem), 0);
  if(falta <= 0) return;
  const id = novoId();
  dados.pagamentos.push({ id, carro:cid, semana:sem, valor:falta, data:hoje(), forma:formaHabitual(cid) });
  await salvar(); render();
  avisoDesfazer(`Pago ${moeda(falta)} · ${c.motorista || c.placa}`, () => desfazerPagamento(id));
}

async function desfazerPagamento(id){
  dados.pagamentos = dados.pagamentos.filter(p => p.id !== id);
  await salvar(); render(); aviso('Desfeito');
}

function formCarro(cid){
  const c = cid?carroDe(cid):{placa:'',modelo:'',motorista:'',telefone:'',valor:'',compra:'',dia:'Sexta-feira',doc:'Em dia',docVenc:'',km:'',obs:'',desde:''};
  const dias = ['Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado','Domingo'];
  abrir(`<h3>${cid?'Editar carro':'Novo carro'}</h3>
    <div class="dupla">
      <div><label for="cp">Placa</label><input id="cp" value="${esc(c.placa)}" placeholder="ABC1D23" maxlength="8" style="text-transform:uppercase"></div>
      <div><label for="ck">Km atual</label><input id="ck" type="number" value="${c.km||''}" placeholder="120000"></div>
    </div>
    <label for="cm">Modelo e ano</label><input id="cm" value="${esc(c.modelo)}" placeholder="Chevrolet Onix 2019">
    <div class="dupla">
      <div><label for="cd">Motorista</label><input id="cd" value="${esc(c.motorista)}" placeholder="Nome"></div>
      <div><label for="ct">Telefone</label><input id="ct" value="${esc(c.telefone)}" placeholder="(21) 90000-0000"></div>
    </div>
    <div class="dupla">
      <div><label for="cv">Aluguel semanal (R$)</label><input id="cv" type="number" step="10" value="${c.valor}" placeholder="500"></div>
      <div><label for="cc">Valor de compra (R$)</label><input id="cc" type="number" step="100" value="${c.compra||''}" placeholder="50000"></div>
    </div>
    <div class="dupla">
      <div><label for="cw">Dia em que o aluguel vence</label>
        <select id="cw">${dias.map(d=>`<option ${d===c.dia?'selected':''}>${d}</option>`).join('')}</select></div>
      <div><label for="cy">Aluguel começou em</label><input id="cy" type="date" value="${c.desde||''}"></div>
    </div>
    <small class="motorista" style="display:block;margin-top:4px">A caderneta conta uma semana de aluguel a partir dessa data. Deixe em branco pra contar do primeiro pagamento.</small>
    <div class="dupla">
      <div><label for="cs">Documentação</label>
        <select id="cs">${['Em dia','Pendente'].map(o=>`<option ${o===c.doc?'selected':''}>${o}</option>`).join('')}</select></div>
      <div><label for="cx">Vence em</label><input id="cx" type="date" value="${c.docVenc||''}"></div>
    </div>
    <label for="co">Observações</label><textarea id="co" placeholder="Pneus novos, ar fraco, contrato...">${esc(c.obs)}</textarea>
    <div class="acoes">
      <button class="btn-vazio" onclick="fechar()">Cancelar</button>
      <button class="btn" onclick="salvarCarro(${cid?`'${cid}'`:'null'})">Salvar carro</button>
    </div>
    ${cid && !temHistorico(cid) ? `<div style="text-align:center;margin-top:16px">
      <button class="apagar" onclick="apagarCarro('${cid}')">Excluir carro</button></div>` : ''}
    ${cid && temHistorico(cid) && !ehVendido(c) ? `<div style="text-align:center;margin-top:16px">
      <button class="apagar" onclick="formVenda('${cid}')">Marcar como vendido</button></div>` : ''}`);
}
async function salvarCarro(cid){
  const placa = $('cp').value.trim().toUpperCase(), modelo = $('cm').value.trim(), valor = Number($('cv').value);
  if(!placa) return aviso('Preencha a placa.');
  if(!modelo) return aviso('Preencha o modelo do carro.');
  if(!valor||valor<=0) return aviso('Preencha o aluguel semanal.');
  const d = {placa,modelo,valor,motorista:$('cd').value.trim(),telefone:$('ct').value.trim(),
             compra:Number($('cc').value)||0,dia:$('cw').value,doc:$('cs').value,
             docVenc:$('cx').value,km:Number($('ck').value)||0,obs:$('co').value.trim(),
             desde:$('cy').value};
  if(cid) Object.assign(dados.carros.find(c=>c.id===cid), d);
  else dados.carros.push({id:novoId(),status:'ativo',...d});
  await salvar(); fechar(); render(); aviso(cid?'Carro atualizado':'Carro cadastrado');
}

function formGasto(gid, cidPadrao){
  const listaCarros = carrosAtivos();
  if(!listaCarros.length) return aviso('Cadastre um carro primeiro.');
  const g = gid ? dados.gastos.find(x=>x.id===gid)
                : {carro:cidPadrao||listaCarros[0].id,data:hoje(),categoria:'Manutenção',descricao:'',
                   oficina:'',km:'',valor:'',status:'Concluída',proximo:'',obs:''};
  const indLig = gid ? dados.indisponibilidades.find(x => x.gasto === gid) : null;
  // se editando um gasto de carro vendido, mantém a opção dele na lista
  const opcoes = gid && !listaCarros.some(c=>c.id===g.carro) ? [...listaCarros, carroDe(g.carro)] : listaCarros;
  abrir(`<h3>${gid?'Editar gasto':'Novo gasto ou serviço'}</h3>
    <label for="gc">Carro</label>
    <select id="gc">${opcoes.map(c=>`<option value="${c.id}" ${c.id===g.carro?'selected':''}>${esc(c.placa)} — ${esc(c.modelo)}</option>`).join('')}</select>
    <div class="dupla">
      <div><label for="gk">Categoria</label>
        <select id="gk">${CATEGORIAS.map(o=>`<option ${o===g.categoria?'selected':''}>${o}</option>`).join('')}</select></div>
      <div><label for="gd">Data</label><input id="gd" type="date" value="${g.data}"></div>
    </div>
    <label for="ge">O que foi feito</label><input id="ge" value="${esc(g.descricao)}" placeholder="Troca de pneus, revisão, IPVA 2026...">
    <div class="dupla">
      <div><label for="gv">Valor (R$)</label><input id="gv" type="number" step="10" value="${g.valor}" placeholder="1200"></div>
      <div><label for="gm">Km na data</label><input id="gm" type="number" value="${g.km||''}" placeholder="145000"></div>
    </div>
    <label for="gf">Oficina ou fornecedor</label><input id="gf" value="${esc(g.oficina)}" placeholder="Oficina do Marcos — Méier">
    <div class="dupla">
      <div><label for="gs">Situação</label>
        <select id="gs">${['Concluída','Agendada','Pendente'].map(o=>`<option ${o===g.status?'selected':''}>${o}</option>`).join('')}</select></div>
      <div><label for="gp">Próxima vez em</label><input id="gp" type="date" value="${g.proximo||''}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:16px;font-weight:600">
      <input type="checkbox" id="gind" ${indLig?'checked':''} style="width:auto"
        onchange="$('gindBox').hidden=!this.checked;if(this.checked&&!$('gii').value)$('gii').value=$('gd').value"> Carro ficou parado (não rodou)</label>
    <div id="gindBox" ${indLig?'':'hidden'}>
      <div class="dupla">
        <div><label for="gii">Parado desde</label><input id="gii" type="date" value="${indLig?indLig.inicio:''}"></div>
        <div><label for="gif">Voltou em</label><input id="gif" type="date" value="${indLig?indLig.fim:''}"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <input type="checkbox" id="gis" ${!indLig||indLig.suspende?'checked':''} style="width:auto"> Não cobrar o aluguel nesses dias</label>
    </div>
    <div class="acoes">
      <button class="btn-vazio" onclick="fechar()">Cancelar</button>
      <button class="btn" onclick="salvarGasto(${gid?`'${gid}'`:'null'})">Salvar gasto</button>
    </div>`);
}
async function salvarGasto(gid){
  const valor = Number($('gv').value);
  if(!$('ge').value.trim()) return aviso('Escreva o que foi feito.');
  if(!valor||valor<=0) return aviso('Preencha o valor do gasto.');
  const cid = $('gc').value, km = Number($('gm').value)||0;
  const d = {carro:cid,data:$('gd').value,categoria:$('gk').value,descricao:$('ge').value.trim(),
             oficina:$('gf').value.trim(),km,valor,status:$('gs').value,proximo:$('gp').value};
  const carro = dados.carros.find(c=>c.id===cid);
  const kmAntes = carro ? carro.km : undefined;
  let novoIdGasto = null;
  if(gid) Object.assign(dados.gastos.find(x=>x.id===gid), d);
  else { novoIdGasto = novoId(); dados.gastos.push({id:novoIdGasto,...d}); }
  if(carro && km > Number(carro.km||0)) carro.km = km;

  // indisponibilidade vinculada a esse gasto
  const gastoId = gid || novoIdGasto;
  const indAtual = dados.indisponibilidades.find(x => x.gasto === gastoId);
  if($('gind') && $('gind').checked){
    const ini = $('gii').value || d.data;
    const reg = { carro:cid, gasto:gastoId, inicio:ini, fim:$('gif').value||'', suspende:$('gis').checked, obs:indAtual?indAtual.obs||'':'' };
    if(indAtual) Object.assign(indAtual, reg);
    else dados.indisponibilidades.push({ id:novoId(), ...reg });
  }else if(indAtual){
    dados.indisponibilidades = dados.indisponibilidades.filter(x => x.id !== indAtual.id);
  }

  await salvar(); fechar(); render();
  if(novoIdGasto){
    avisoDesfazer('Gasto lançado', async ()=>{
      dados.gastos = dados.gastos.filter(g=>g.id!==novoIdGasto);
      dados.indisponibilidades = dados.indisponibilidades.filter(x=>x.gasto!==novoIdGasto);
      if(carro) carro.km = kmAntes;
      await salvar(); render(); aviso('Desfeito');
    });
  }else{
    aviso('Gasto atualizado');
  }
}

let acaoPendente = null;
function confirmar(texto, rotulo, acao){
  acaoPendente = acao;
  abrir(`<h3>Tem certeza?</h3><p class="sub">${texto}</p>
    <div class="acoes">
      <button class="btn-vazio" onclick="fechar()">Não, voltar</button>
      <button class="btn" style="background:var(--atr)" onclick="executarPendente()">${rotulo}</button>
    </div>`);
}
async function executarPendente(){
  const f = acaoPendente; acaoPendente = null;
  if(f) await f();
}

function apagarCarro(cid){
  if(temHistorico(cid)) return aviso('Esse carro tem lançamentos. Marque como vendido pra guardar o histórico.');
  confirmar('Esse carro não tem nenhum pagamento nem gasto. Excluir de vez?','Excluir carro', async ()=>{
    dados.carros = dados.carros.filter(c=>c.id!==cid);
    dados.indisponibilidades = dados.indisponibilidades.filter(x=>x.carro!==cid);
    await salvar(); fechar(); render(); aviso('Carro excluído');
  });
}
function apagarPagamento(pid){
  confirmar('Este pagamento sai do histórico e a semana volta a aparecer como pendente.','Excluir pagamento', async ()=>{
    dados.pagamentos = dados.pagamentos.filter(p=>p.id!==pid);
    await salvar(); fechar(); render(); aviso('Pagamento excluído');
  });
}
function apagarGasto(gid){
  confirmar('Este gasto sai da manutenção e do balanço do carro.','Excluir gasto', async ()=>{
    dados.gastos = dados.gastos.filter(g=>g.id!==gid);
    dados.indisponibilidades.forEach(x=>{ if(x.gasto===gid) x.gasto = null; });  // o período parado continua
    await salvar(); fechar(); render(); aviso('Gasto excluído');
  });
}
function limparExemplo(){
  confirmar('Os quatro carros de exemplo e os lançamentos deles serão removidos. Depois é só cadastrar os carros de verdade.','Limpar exemplos', async ()=>{
    dados = {carros:[],pagamentos:[],gastos:[],indisponibilidades:[],exemplo:false};
    await salvar(); aba='carros'; fechar(); render(true); aviso('Pronto, agora é só cadastrar os carros');
  });
}

let t, toastDesfazer = null;
function mostrarToast(msg, undoFn){
  toastDesfazer = undoFn || null;
  $('toast').innerHTML = esc(msg)
    + (undoFn ? ` <button class="toast-undo" onclick="executarDesfazer()">Desfazer</button>` : '');
  $('toast').classList.add('aberto');
  clearTimeout(t);
  t = setTimeout(()=>{ $('toast').classList.remove('aberto'); toastDesfazer = null; }, undoFn ? 6000 : 2600);
}
function aviso(msg){ mostrarToast(msg, null); }
function avisoDesfazer(msg, undoFn){ mostrarToast(msg, undoFn); }
async function executarDesfazer(){
  const f = toastDesfazer; toastDesfazer = null;
  $('toast').classList.remove('aberto'); clearTimeout(t);
  if(f) await f();
}

$('semAnt').onclick = ()=>{ if(!appLiberado) return; offsetSemana--; render(true); };
$('semProx').onclick = ()=>{ if(!appLiberado) return; if(offsetSemana<0){ offsetSemana++; render(true); } };
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{ if(!appLiberado) return; aba=b.dataset.aba; render(true); });

$('btnSync').onclick = async ()=>{
  $('btnSync').classList.add('rodando');
  $('btnSync').disabled = true;
  await recarregarSuave();
  $('btnSync').classList.remove('rodando');
  $('btnSync').disabled = false;
};

$('btnSair').onclick = ()=>{
  confirmar('Você vai precisar entrar de novo com e-mail e senha neste aparelho.', 'Sair', sair);
};

$('btnCodigo').onclick = gerenciarCodigo;

$('loginForm').addEventListener('submit', fazerLogin);

// Teclado do código de acesso
$('pinTeclado').addEventListener('click', (e)=>{
  const b = e.target.closest('button');
  if(!b) return;
  if(b.id === 'pinApaga') apagarPin();
  else digitarPin(b.textContent.trim());
});
$('pinLink').addEventListener('click', acaoPinLink);

// Atualiza sozinho: ao voltar pro app e a cada 60s enquanto estiver aberto.
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') recarregarSuave(); });

async function iniciarApp(){
  $('conteudo').innerHTML = `<div class="vazio"><p>Carregando…</p></div>`;
  try{
    await carregar();
  }catch(e){
    appLiberado = false;
    $('conteudo').innerHTML = `<div class="vazio">
      <p>Não consegui carregar os dados agora.<br>
      <small>${esc(String(e && e.message || e))}</small></p>
      <button class="btn" onclick="iniciarApp()">Tentar de novo</button></div>`;
    return;
  }
  appLiberado = true;
  render(true);
  if(!timerSync){
    timerSync = setInterval(()=>{ if(document.visibilityState==='visible') recarregarSuave(); }, 60000);
  }
}

iniciarSessao();
