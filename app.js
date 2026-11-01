"use strict";
(()=>{
const CFG=window.APP_CONFIG||{};
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=(n,d=0)=>(+n).toLocaleString("pt-BR",{minimumFractionDigits:d,maximumFractionDigits:d});
const num=v=>{const x=parseFloat(String(v??"").replace(",","."));return isNaN(x)?null:x};
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const norm=s=>String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const uid=()=>crypto.randomUUID();
const nowISO=()=>new Date().toISOString();
const toast=t=>{const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove("on"),2600)};

/* ---------- Estado local (offline primeiro) ---------- */
const KEY="pc3";
const DEF={onboarded:false,profile:null,settings:{meals:["1ª refeição","2ª refeição","3ª refeição","4ª refeição"],pinHash:null,pinSalt:null,lembrete:false,wifi:false,plan:{dias:4,min:60,int:1},semIni:1,pesoFreq:"livre"},customFoods:[],treinos:[],saude:[],entries:[],days:{},outbox:[],last:null,session:null,usage:{},imported:{},localOnly:false,dieta:null,fin:null,auto:{on:false,ritmo:1,applied:null,lastRev:null,base:null,rev:null}};
let S;
try{S=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){S={}}
S={...structuredClone(DEF),...S};S.settings={...DEF.settings,...S.settings,plan:{...DEF.settings.plan,...(S.settings||{}).plan}};
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){toast("Sem espaço para salvar no aparelho")}};
const rowKey=(t,r)=>t==="days"?r.date:t==="user_state"?"s":r.id;
function queue(t,row,quiet){const k=rowKey(t,row);S.outbox=S.outbox.filter(o=>!(o.t===t&&o.k===k));S.outbox.push({t,k,row});if(!quiet){save();Cloud.sync()}}
const stateRow=()=>{const{pinHash,pinSalt,...st}=S.settings;return{profile:S.profile,settings:st,customFoods:S.customFoods,treinos:S.treinos,saude:S.saude,dieta:S.dieta,fin:S.fin,auto:S.auto}};
const queueState=()=>{if(S.profile)queue("user_state",stateRow())};

/* ---------- Nuvem (Supabase: login + RLS) ---------- */
const stat={ok:false,t:"Neste aparelho"};
const Cloud={
  on:()=>/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(CFG.supabaseUrl||"")&&!!CFG.supabaseKey,
  h(tok){return{apikey:CFG.supabaseKey,Authorization:"Bearer "+(tok||CFG.supabaseKey),"Content-Type":"application/json"}},
  async auth(path,body){const r=await fetch(CFG.supabaseUrl+"/auth/v1/"+path,{method:"POST",headers:this.h(),body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.msg||j.error_description||j.message||"Falha no login");return j},
  setSession(j){if(!j.access_token)return false;S.session={at:j.access_token,rt:j.refresh_token,exp:Date.now()+(j.expires_in||3600)*1000,uid:j.user.id,email:j.user.email};save();return true},
  async signIn(e,p){return this.setSession(await this.auth("token?grant_type=password",{email:e,password:p}))},
  async signUp(e,p){return this.setSession(await this.auth("signup",{email:e,password:p}))},
  async token(){const s=S.session;if(!s)throw new Error("sem sessão");if(s.exp-Date.now()<60000){try{this.setSession(await this.auth("token?grant_type=refresh_token",{refresh_token:s.rt}))}catch(e){S.session=null;save();throw e}}return S.session.at},
  async rest(method,path,body,extra){const r=await fetch(CFG.supabaseUrl+"/rest/v1/"+path,{method,headers:{...this.h(await this.token()),...extra},body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error("HTTP "+r.status);return method==="GET"?r.json():null},
  busy:false,
  async sync(){
    if(!this.on()||!S.session||!navigator.onLine||this.busy)return;
    if(S.settings.wifi&&navigator.connection&&navigator.connection.type==="cellular")return;
    this.busy=true;
    try{
      const u=S.session.uid,sent=[...S.outbox],by=t=>sent.filter(o=>o.t===t).map(o=>o.row);
      const conf={entries:"id",days:"user_id,date",user_state:"user_id"};
      const map={
        entries:r=>({id:r.id,user_id:u,date:r.date,meal:r.meal,food_name:r.name,qty:r.qty,unit:r.unit,kcal:r.k,p:r.p,c:r.c,g:r.g,deleted:!!r.deleted}),
        days:r=>({user_id:u,date:r.date,tipo:r.tipo||"",treino:r.treino||"",peso:r.peso??null,gasto:r.gasto??null}),
        user_state:r=>({user_id:u,data:r})};
      for(const t of ["entries","days","user_state"]){const rows=by(t).map(map[t]);for(let i=0;i<rows.length;i+=400)await this.rest("POST",`${t}?on_conflict=${conf[t]}`,rows.slice(i,i+400),{Prefer:"resolution=merge-duplicates,return=minimal"})}
      S.outbox=S.outbox.filter(o=>!sent.includes(o));
      await this.pull();
      setStat(true,"Sincronizado");
    }catch(e){setStat(false,S.session?"Sem sincronia":"Entre na conta");if(!S.session&&needLogin()&&view!=="login"){view="login";render()}}
    finally{this.busy=false;save()}
  },
  async pull(){
    const q=S.last?`&updated_at=gt.${encodeURIComponent(S.last)}`:"";
    const[en,dy,us]=await Promise.all([this.rest("GET",`entries?select=*&order=updated_at.asc${q}`),this.rest("GET",`days?select=*&order=updated_at.asc${q}`),this.rest("GET",`user_state?select=*${q}`)]);
    const pend=new Set(S.outbox.map(o=>o.t+o.k));let max=S.last||"";
    for(const r of en){if(r.updated_at>max)max=r.updated_at;if(pend.has("entries"+r.id))continue;
      const e={id:r.id,date:r.date,meal:r.meal,name:r.food_name,qty:+r.qty,unit:r.unit,k:+r.kcal,p:+r.p,c:+r.c,g:+r.g,deleted:r.deleted};
      const i=S.entries.findIndex(x=>x.id===e.id);i<0?S.entries.push(e):S.entries[i]=e}
    for(const r of dy){if(r.updated_at>max)max=r.updated_at;if(pend.has("days"+r.date))continue;
      S.days[r.date]={tipo:r.tipo,treino:r.treino,peso:r.peso==null?null:+r.peso,gasto:r.gasto==null?null:+r.gasto}}
    for(const r of us){if(r.updated_at>max)max=r.updated_at;if(pend.has("user_states")||!r.data)continue;
      const d=r.data;if(d.profile){S.profile=d.profile;S.onboarded=true}
      if(d.settings)S.settings={...S.settings,...d.settings,pinHash:S.settings.pinHash,pinSalt:S.settings.pinSalt};
      if(d.customFoods)S.customFoods=d.customFoods;
      if(Array.isArray(d.treinos))S.treinos=d.treinos;
      if(Array.isArray(d.saude))S.saude=d.saude;
      if(d.dieta!==undefined)S.dieta=d.dieta;
      if(d.fin)S.fin=Fin.norm(d.fin);
      if(d.auto)S.auto={...S.auto,...d.auto}}
    if(max)S.last=max;
    if(!$(".scroll input:focus"))render();
  },
  queueAll(){S.entries.forEach(e=>queue("entries",e));Object.entries(S.days).forEach(([date,d])=>queue("days",{date,...d}));queueState()}
};
function setStat(ok,t){stat.ok=ok;stat.t=t;const c=$(".chip");if(c)c.innerHTML=`<i class="dot ${ok?"ok":""}"></i>${esc(t)}`}

/* ---------- PIN local (trava de tela; a proteção dos dados na nuvem é o login) ---------- */
const b64=a=>btoa(String.fromCharCode(...new Uint8Array(a)));
async function hashPin(pin,salt){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(pin),"PBKDF2",false,["deriveBits"]);return b64(await crypto.subtle.deriveBits({name:"PBKDF2",salt:Uint8Array.from(atob(salt),c=>c.charCodeAt(0)),iterations:200000,hash:"SHA-256"},k,256))}
async function storePin(pin){const salt=b64(crypto.getRandomValues(new Uint8Array(16)));S.settings.pinSalt=salt;S.settings.pinHash=await hashPin(pin,salt);save()}
let fails=0,blockedUntil=0;

/* ---------- Alimentos e cálculos ---------- */
let BASE=[];
const foods=()=>BASE.concat(S.customFoods);
const day=d=>S.days[d]||(S.days[d]={tipo:"",treino:"",peso:null,gasto:null});
const ents=d=>S.entries.filter(e=>e.date===d&&!e.deleted);
const sum=l=>l.reduce((a,e)=>({k:a.k+e.k,p:a.p+e.p,c:a.c+e.c,g:a.g+e.g}),{k:0,p:0,c:0,g:0});
const pesoList=()=>Object.entries(S.days).filter(([,d])=>d.peso).sort((a,b)=>a[0]<b[0]?-1:1);
function pesoTend(){const l=pesoList();if(!l.length)return null;const lim=new Date();lim.setDate(lim.getDate()-6);const w=l.filter(([d])=>d>=iso(lim)).map(([,x])=>x.peso);return w.length?w.reduce((a,b)=>a+b,0)/w.length:l[l.length-1][1].peso}
function calcGasto(){const p0=S.profile;if(!p0)return null;const p={...p0,peso:pesoTend()||p0.peso};const tmb=10*p.peso+6.25*p.alt-5*p.idade+(p.sexo==="f"?-161:5),rest=tmb*1.2,pl=S.settings.plan,MET=[4.5,6,8][pl.int],extra=pl.dias>0?(MET-1)*p.peso*pl.min/60:0;return{tmb,rest,trein:rest+extra,extra,peso:p.peso}}
function metaFor(tipo){const c=calcGasto(),k=tipo==="Treino"?"treino":"descanso",ap=!hasPlan()&&S.auto.on&&S.auto.applied&&S.auto.applied[k];
  if(ap&&ap.k>0&&c){const g=tipo==="Treino"?c.trein:c.rest;return{k:ap.k,p:ap.p,c:ap.c,g:ap.g,gasto:Math.round(g),auto:true}}
  const pm=S.dieta&&S.dieta.metas,pk=pm&&(pm[k]||pm.treino||pm.descanso);
  if(pk&&pk.k>0){const g=pk.gasto>0?pk.gasto:c?(tipo==="Treino"?c.trein:c.rest):0;return{k:Math.round(pk.k),p:Math.round(pk.p),c:Math.round(pk.c),g:Math.round(pk.g),gasto:Math.round(g),plano:true}}
  if(!c)return{k:0,p:0,c:0,g:0,gasto:0};const gasto=tipo==="Treino"?c.trein:c.rest;
  return{k:0,p:0,c:0,g:0,gasto:Math.round(gasto)}}
function search(q){
  const tk=norm(parseQ(q).name).split(" ").filter(Boolean);
  const use=f=>S.usage[f.n]||0;
  if(!tk.length)return foods().sort((a,b)=>use(b)-use(a)||a.n.localeCompare(b.n)).slice(0,12);
  return foods().map(f=>{f._n=f._n||norm(f.n);const ws=f._n.split(" ");if(!tk.every(t=>ws.some(w=>w.startsWith(t))))return null;return{f,s:Math.min(use(f),10)*.6-f.n.length/60+(f._n.startsWith(tk[0])?1:0)}}).filter(Boolean).sort((a,b)=>b.s-a.s).slice(0,12).map(x=>x.f);
}
function parseQ(t){const m=t.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|un\w*)?\s*(?:de\s+)?(.+)$/i);if(!m)return{q:null,name:t.trim()};let q=num(m[1]);const u=(m[2]||"").toLowerCase();if(u==="kg"||u==="l")q*=1000;return{q,name:m[3]}}
const amt=x=>x.pi!=null&&x.f.ps&&x.f.ps[x.pi]?x.f.ps[x.pi].q*(+x.q||0):(+x.q||0);

/* ---------- Navegação e estado de tela ---------- */
const today=()=>iso(new Date());
const needLogin=()=>Cloud.on()&&!S.session&&!S.localOnly;
let devOn=false,devTaps=0,editMeals=false,view=needLogin()?"login":S.onboarded?"inicio":"onb",cur=today(),meal=0,draft=[],nf=null,revForce=false,hrng=1,pinBuf="",locked=!!S.settings.pinHash,q="";
let ob={step:0,goal:0,sexo:"m",nome:"",idade:"",alt:"",peso:"",email:"",pw:""};
const MAIN=["hoje","lancar","peso","ajustes"],SUB={hist:"ajustes",calc:"ajustes",cad:"ajustes",conta:"ajustes",setpin:"ajustes"};
const go=v=>{if(v!=="ajuste")revForce=false;view=v;pinBuf="";render()};

const FINV=["fresumo","fcontas","fviagem"],TREV=["treino","thist","tplano"];
const nav=()=>{const tabs=FINV.includes(view)?[["fresumo","Resumo"],["fcontas","Contas"],["fviagem","Viagem"]]:TREV.includes(view)?[["treino","Hoje"],["thist","Histórico"],["tplano","Plano"]]:[["hoje","Hoje"],["peso","Peso"],["hist","Histórico"]];
  return `<nav><button data-a="go" data-v="inicio"><i></i>Início</button>${tabs.map(([k,n])=>`<button data-a="go" data-v="${k}" class="${view===k||(k==="hoje"&&view==="lancar")?"on":""}"><i></i>${n}</button>`).join("")}</nav>`};
const page=(body,{back,nonav}={})=>{const up=back||(nonav?"":view==="lancar"?"hoje":"inicio");return `<div class="scroll">${up?`<button class="back" data-a="go" data-v="${up}">‹ Voltar</button>`:""}${body}</div>${back||nonav?"":nav()}`};
const pad=()=>`<div class="pins">${[0,1,2,3].map(i=>`<i class="${i===pinBuf.length?"cur":""}">${pinBuf[i]?"●":""}</i>`).join("")}</div><div class="keys">${["1","2","3","4","5","6","7","8","9","","0","⌫"].map(k=>k?`<button data-a="key" data-k="${k}" aria-label="${k}">${k}</button>`:"<span></span>").join("")}</div>`;
const field=(id,label,val="",ph="",extra="")=>`<div class="fld"><label for="${id}">${label}</label><input id="${id}" value="${esc(val)}" placeholder="${esc(ph)}" ${extra}></div>`;

/* ---------- Telas ---------- */
function vOnb(){
  const s=ob.step,GOALS=[["Perder peso","Déficit calórico moderado"],["Manter o peso","Comer o que você gasta"],["Ganhar massa","Superávit com proteína alta"]];
  let body;
  if(s===0)body=`<div class="logo">P</div><div class="hero">Controle de peso e calorias, sem complicação.</div><p class="mu">Lance refeições em segundos, acompanhe sua evolução e use mesmo sem internet.</p><div class="lbl">Qual é o seu objetivo?</div>${GOALS.map((g,i)=>`<button class="pick ${ob.goal===i?"on":""}" data-a="goal" data-i="${i}">${g[0]}<small>${g[1]}</small></button>`).join("")}`;
  else if(s===1)body=`<div class="hero" style="font-size:30px">Conte um pouco sobre você</div><p class="mu">Usamos esses dados só para calcular o seu gasto calórico.</p><div class="grid2">${field("o_nome","Nome",ob.nome,"Como quer ser chamado",'maxlength="30" autocomplete="given-name"').replace('class="fld"','class="fld" style="grid-column:1/-1"')}${field("o_idade","Idade",ob.idade,"anos",'inputmode="numeric"')}${field("o_alt","Altura (cm)",ob.alt,"",'inputmode="numeric"')}${field("o_peso","Peso (kg)",ob.peso,"",'inputmode="decimal"')}<div class="fld"><label>Sexo</label><div class="seg"><button data-a="sexo" data-s="m" class="${ob.sexo==="m"?"on":""}">M</button><button data-a="sexo" data-s="f" class="${ob.sexo==="f"?"on":""}">F</button></div></div></div>`;
  else body=`<div class="hero" style="font-size:30px">Proteja seus dados</div><p class="mu">${Cloud.on()?"Crie uma conta para guardar tudo na nuvem e defina um PIN para abrir o app.":"A nuvem não está configurada: os dados ficam só neste aparelho. Defina um PIN para abrir o app."}</p>${Cloud.on()?`${field("o_email","E-mail",ob.email,"voce@email.com",'type="email" autocomplete="email" autocapitalize="off"')}<div style="height:10px"></div>${field("o_pw","Senha (mín. 8 caracteres)",ob.pw,"",'type="password" autocomplete="new-password"')}`:""}<div class="lbl">PIN de 4 dígitos</div>${pad()}`;
  const last=s===2;
  return `<div class="scroll" style="display:flex;flex-direction:column"><div class="steps">${[0,1,2].map(i=>`<i class="${i<=s?"on":""}"></i>`).join("")}</div><div style="flex:1">${body}</div><button class="btn" style="margin-top:20px" data-a="obNext">${last?(Cloud.on()?"Criar conta e entrar":"Começar"):"Continuar"}</button>${last&&Cloud.on()?`<button class="lk" data-a="obLocal">Usar só neste aparelho</button>`:s>0?`<button class="lk" data-a="obBack">Voltar</button>`:Cloud.on()?`<button class="lk" data-a="toLogin">Já tenho conta</button>`:""}</div>`;
}
function vLock(){return `<div class="lock"><div class="logo" style="margin:0 auto 18px">P</div><h1>Digite seu PIN</h1><p class="mu" id="lockMsg">${Date.now()<blockedUntil?"Muitas tentativas. Aguarde um pouco.":"&nbsp;"}</p>${pad()}</div>`}
function weekTot(){const hj=today();let tk=0,tg=0,n=0;week().forEach(d=>{const k=sum(ents(d)).k,D=day(d);if(d<hj&&k>0){const g=D.gasto||metaFor(D.tipo||"Descanso").gasto;if(g){tg+=g;tk+=k;n++}}});return{tk,tg,n,res:tk-tg}}
const tipoLbl=D=>(D.tipo||"Descanso")==="Treino"?"treino":"descanso";
function ringCard(t,m,D){
  const g=D.gasto||m.gasto,plan=m.k>0,ref=plan?m.k:g,pct=ref?t.k/ref:0,falta=m.k-t.k,s=t.k-g,hj=cur===today(),C=2*Math.PI*50;
  const msg=plan?(falta>=0?`Faltam ${fmt(falta)} kcal`:`Passou ${fmt(-falta)} kcal`):(g?(t.k?`${hj?"Saldo parcial":"Saldo"}: ${s>0?"+":s<0?"−":""}${fmt(Math.abs(s))} kcal`:"Nenhuma refeição lançada"):"Complete o cadastro em Ajustes");
  const arc=(p,c)=>p>0?`<circle cx="60" cy="60" r="50" fill="none" stroke="${c}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${(Math.max(p,.004)*C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>`:"";
  const R2=34,C2=2*Math.PI*R2,pg=g?t.k/g:0,arc2=(p,c)=>p>0?`<circle cx="60" cy="60" r="${R2}" fill="none" stroke="${c}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${(Math.max(p,.004)*C2).toFixed(1)} ${C2.toFixed(1)}" transform="rotate(-90 60 60)"/>`:"";
  const inner=plan&&g?`<circle cx="60" cy="60" r="${R2}" fill="none" stroke="var(--bad)" stroke-opacity=".2" stroke-width="11"/>${arc2(Math.min(pg,1),"var(--bad)")}${pg>1?arc2(Math.min(pg-1,1),"#ffb4a8"):""}`:"";
  const svg=`<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--ac)" stroke-opacity=".2" stroke-width="13"/>${arc(Math.min(pct,1),"var(--ac)")}${pct>1?arc(Math.min(pct-1,1),"var(--bad)"):""}${inner}</svg>`;
  const leg=plan&&g?`<div class="mu" style="font-size:12px;margin-top:10px"><span style="color:var(--ac)">●</span> Meta ${fmt(m.k)} &nbsp; <span style="color:var(--bad)">●</span> Gasto ${tipoLbl(D)} ${fmt(g)}</div>`:"";
  const wk=weekTot(),dayLbl=hj?"Hoje":cur.slice(8)+"/"+cur.slice(5,7);
  const word=v=>v<0?"Déficit":v>0?"Superávit":"Equilíbrio";
  const blk=(titulo,ing,gas,res,parcial)=>`<div class="blk"><b>${titulo}</b><div class="br"><span>Ingeridas</span><b>${ing!=null?fmt(ing):"—"}</b></div><div class="br"><span>Gastas</span><b>${gas?fmt(gas):"—"}</b></div><div class="br"><span>${res==null?"Déficit/superávit":word(res)+(parcial?" parcial":"")}</span><b>${res==null?"—":fmt(Math.abs(res))}</b></div></div>`;
  return `<div class="card" style="padding:22px 18px;text-align:center"><div class="ring">${svg}<div><b>${fmt(t.k)}</b><small>${ref?`de ${fmt(ref)} kcal${plan?"":" gastas"}`:"kcal ingeridas"}</small></div></div>${leg}<div class="${plan?(falta<0?"bad":"good"):(!t.k||s<=0?"mu":"good")}" style="margin-top:12px;font-weight:600;font-size:14px">${msg}</div><div class="mu" style="font-size:11px;margin-top:4px">${m.plano?"Meta do seu plano alimentar":m.auto?"Meta automática: estimativa pelo seu peso e objetivo":"Sem plano alimentar importado: comparando com o gasto do dia"}</div>
  <div class="dual">${blk(dayLbl,t.k,g,t.k&&g?s:null,hj)}${blk("Semana",wk.n?wk.tk:null,wk.n?wk.tg:null,wk.n?wk.res:null,false)}</div><div class="mu" style="font-size:11px;margin-top:8px">A semana soma só os dias já fechados, sem o dia de hoje.</div></div>`;
}
function vHoje(){
  const D=day(cur),tipo=D.tipo||"Descanso",m=metaFor(tipo),es=ents(cur),t=sum(es),dt=new Date(cur+"T12:00:00");
  return page(`<div class="top"><div><div class="mu">${cur===today()?"Hoje, ":""}${dt.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div><h1>Nutrição</h1></div><span class="chip"><i class="dot ${stat.ok?"ok":""}"></i>${esc(stat.t)}</span></div>
  <div class="dnav"><button data-a="day" data-n="-1" aria-label="Dia anterior">‹</button><button class="tipochip" data-a="go" data-v="treino"><b>${tipo==="Treino"?"Dia de treino":"Dia de descanso"}</b><small>alterar no Treino ›</small></button><button data-a="day" data-n="1" aria-label="Próximo dia" ${cur>=today()?"disabled style='opacity:.3'":""}>›</button></div>
  ${revBanner()}${ringCard(t,m,D)}
  <div class="grid3">${[["Proteína","p"],["Carbo","c"],["Gordura","g"]].map(([n,f])=>`<div class="mini"><small>${n}</small><b>${fmt(t[f])}</b><small style="display:inline"> g</small>${m[f]?`<div class="bar"><i style="width:${Math.min(100,t[f]/m[f]*100)}%"></i></div>`:""}${m[f]?`<small class="${m[f]>=t[f]?"mu":"bad"}" style="display:block;margin-top:6px">${m[f]>=t[f]?"faltam "+fmt(m[f]-t[f]):"passou "+fmt(t[f]-m[f])} g</small>`:""}</div>`).join("")}</div>
  <div class="rh"><h2>Refeições</h2><button class="lk" data-a="mealEdit">${editMeals?"Concluir":"Editar"}</button></div>${editMeals?`<div class="card flush">${S.settings.meals.map((ml,i)=>`<div class="dq"><input class="mn" data-mi="${i}" value="${esc(ml)}" maxlength="30" aria-label="Nome da refeição ${i+1}"><button data-a="mealDel" data-i="${i}" aria-label="Remover ${esc(ml)}">✕</button></div>`).join("")}</div><button class="btn ghost" data-a="mealAdd">＋ Adicionar refeição</button><p class="mu" style="font-size:12px;margin:8px 4px 0">Toque no nome para renomear. Ao remover uma refeição, o que foi lançado nela passa para a refeição anterior.</p>`:`<div class="card flush">${S.settings.meals.map((ml,i)=>{const l=es.filter(e=>e.meal===ml),k=sum(l).k;return`<button class="row" data-a="meal" data-i="${i}"><span class="ck ${l.length?"on":""}">${l.length?"✓":""}</span><span class="n"><b>${esc(ml)}</b><small>${l.length?`${l.length} ${l.length>1?"itens":"item"}`:"Não lançado"}</small></span><b>${l.length?fmt(k):"+"}</b></button>`}).join("")}</div>`}
  ${weekSummary()}`);
}
function weekSummary(){
  const dias=week(),hj=today();let tk=0,tg=0,n=0;
  const cells=dias.map(d=>{const k=sum(ents(d)).k,D=day(d),has=d<=hj&&k>0;let s=null;
    if(has){const g=D.gasto||metaFor(D.tipo||"Descanso").gasto;if(g){s=g-k;if(d<hj){tg+=g;tk+=k;n++}}}
    const lab=has&&s!=null?(d<hj?(s>0?"−":"+")+fmt(Math.abs(s)):"hoje"):"&nbsp;";
    return`<button class="wd ${d===cur?"cur":""}${has?"":" vz"}" data-a="pick" data-d="${d}"><small>${["dom","seg","ter","qua","qui","sex","sáb"][new Date(d+"T12:00:00").getDay()]}</small><b>${has?fmt(k):"—"}</b><i class="${s==null||d===hj?"mu":s>0?"bad":"good"}">${lab}</i></button>`}).join("");
  const res=tg-tk,dm=d=>d.slice(8)+"/"+d.slice(5,7);
  return`<h2>Semana <span class="mu" style="font-weight:400;font-size:13px">${dm(dias[0])} a ${dm(dias[6])}</span></h2><div class="card"><div class="wk">${cells}</div>${n?`<div class="wt"><span class="good">Calorias consumidas</span><b class="good">${fmt(tk)} kcal</b><span class="bad">Calorias gastas</span><b class="bad">${fmt(tg)} kcal</b><span class="${res>0?"bad":"good"}">Saldo calórico</span><b class="${res>0?"bad":"good"}">${res>0?"−":"+"}${fmt(Math.abs(res))} kcal</b></div>`:'<p class="mu" style="font-size:12px;margin:10px 0 0">Os totais aparecem quando houver dias fechados na semana.</p>'}</div>`;
}
function week(){const d=new Date(cur+"T12:00:00"),dif=(d.getDay()-S.settings.semIni+7)%7;d.setDate(d.getDate()-dif);return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return iso(x)})}
const exTxt=f=>{const e=f.ex;if(!e)return"";const z=(f.por||100)/100,L=[["a","Açúcar"," g"],["d","Adic."," g"],["f","Fibra"," g"],["s","Sat."," g"],["t","Trans"," g"],["n","Sódio"," mg"]].filter(([k])=>e[k]!=null).map(([k,n,u])=>n+" "+fmt(e[k]*z,1)+u);return L.length?"<br>"+L.join(" · "):""};
function foodList(){return search(q).map(f=>{const p=parseQ(q),ed=S.customFoods.includes(f)?`<span class="mu" role="button" data-a="nfEdit" data-n="${esc(f.n)}" aria-label="Editar alimento" style="padding:4px 6px;font-size:16px">✎</span>`:"";return`<button class="food" data-a="add" data-n="${esc(f.n)}"><span class="n">${esc(f.n)}<small>${f.por===100&&f.u!=="unid"?"100 "+f.u:f.por+" "+f.u} · P ${fmt(f.p,1)} C ${fmt(f.c,1)} G ${fmt(f.f,1)}${exTxt(f)}</small></span><span class="k">${fmt(f.k)}</span>${ed}<span class="ck on">＋</span></button>`}).join("")||`<p class="mu">Nada encontrado.</p><button class="btn ghost" data-a="newFood">＋ Cadastrar “${esc(parseQ(q).name)}”</button>`}
const tipoDia=()=>(day(cur).tipo||"Descanso")==="Treino"?"treino":"descanso";
function planBox(){
  const r=planRef(meal);if(!r||!r.itens.length)return"";
  return`<div class="lbl">Seu plano · ${esc(r.nome)}</div><div class="card flush">${r.itens.map((it,i)=>`<button class="row" data-a="addPlan" data-i="${i}"><span class="n"><b>${esc(it.n)}</b><small>${fmt(it.q)} ${un(it.u)} · P ${fmt(it.p,1)} C ${fmt(it.c,1)} G ${fmt(it.g,1)}</small></span><b>${fmt(it.k)}</b></button>`).join("")}</div><button class="btn ghost" style="margin-bottom:6px" data-a="planAll">＋ Lançar tudo do plano</button>`}
function vAlimento(){
  if(!nf){view="lancar";return vLancar()}
  return page(`<button class="back" data-a="nfCancel">‹ Voltar</button><div class="card"><div class="lbl" style="margin-top:0">${nf.edit?"Editar alimento":"Novo alimento"} · valores por 100 ${nf.u==="ml"?"ml":"g"}</div><div class="seg" style="margin-bottom:10px"><button data-a="nfUn" data-u="g" class="${nf.u==="ml"?"":"on"}">Em gramas (g)</button><button data-a="nfUn" data-u="ml" class="${nf.u==="ml"?"on":""}">Em mililitros (ml)</button></div>${field("nf_n","Nome",nf.n||"","Ex.: Pão integral",'maxlength="60"')}<div class="grid2">${field("nf_k","Calorias (kcal)",nf.k||"","",'inputmode="decimal"')}${field("nf_p","Proteína (g)",nf.p||"","",'inputmode="decimal"')}${field("nf_c","Carbo (g)",nf.c||"","",'inputmode="decimal"')}${field("nf_f","Gordura (g)",nf.f||"","",'inputmode="decimal"')}</div><div class="lbl">Tabela nutricional (opcional)</div><div class="mu" style="font-size:12px;margin:0 0 8px">Preencha só o que estiver no rótulo. Os valores são por 100 ${nf.u==="ml"?"ml":"g"}.</div><div class="grid2">${field("nf_xa","Açúcares totais (g)",nf.xa||"","",'inputmode="decimal"')}${field("nf_xd","Açúcares adicionados (g)",nf.xd||"","",'inputmode="decimal"')}${field("nf_xf","Fibra alimentar (g)",nf.xf||"","",'inputmode="decimal"')}${field("nf_xs","Gordura saturada (g)",nf.xs||"","",'inputmode="decimal"')}${field("nf_xt","Gordura trans (g)",nf.xt||"","",'inputmode="decimal"')}${field("nf_xn","Sódio (mg)",nf.xn||"","",'inputmode="decimal"')}</div><div class="lbl">Porções (opcional)</div><div class="mu" style="font-size:12px;margin:0 0 8px">Ex.: Lata = 350, Garrafa = 600. O tamanho é em ${nf.u==="ml"?"ml":"g"}.</div>${[0,1,2].map(i=>`<div class="grid2" style="margin-bottom:8px">${field("nf_pn"+i,"Nome",nf["pn"+i]||"","Ex.: Lata",'maxlength="20"')}${field("nf_pq"+i,"Tamanho ("+(nf.u==="ml"?"ml":"g")+")",nf["pq"+i]||"","",'inputmode="decimal"')}</div>`).join("")}<div class="frow"><button class="btn" data-a="nfSave">Salvar alimento</button><button class="btn ghost" data-a="nfCancel">Cancelar</button></div>${nf.edit?`<button class="lk" data-a="nfDel" style="display:block;margin:12px auto 0"><span class="bad">Excluir este alimento</span></button>`:""}</div>`,{nonav:true});
}
function vLancar(){
  const ml=S.settings.meals[meal],done=ents(cur).filter(e=>e.meal===ml),t=draft.reduce((a,x)=>a+x.f.k*amt(x)/x.f.por,0);
  return page(`<h1 style="margin-bottom:14px">Lançar</h1><div class="chips">${S.settings.meals.map((m,i)=>`<button data-a="meal" data-i="${i}" data-stay="1" class="${i===meal?"on":""}">${esc(m)}</button>`).join("")}</div>
  ${planBox()}
  ${draft.length?`<div class="lbl">Montando</div><div class="card flush" style="margin-bottom:12px">${draft.map((x,i)=>`<div class="dq"><span class="n">${esc(x.f.n)}</span><input data-di="${i}" value="${x.q}" placeholder="Qtd" inputmode="decimal" aria-label="Quantidade">${x.f.ps&&x.f.ps.length?`<select data-dp="${i}" aria-label="Medida" style="width:auto;max-width:150px;padding:9px"><option value="">${x.f.u}</option>${x.f.ps.map((m,j)=>`<option value="${j}"${x.pi===j?" selected":""}>${esc(m.n)} (${m.q} ${x.f.u})</option>`).join("")}</select>`:`<span class="mu" style="width:24px">${x.f.u==="unid"?"un":x.f.u}</span>`}<button data-a="rm" data-i="${i}" aria-label="Remover">✕</button></div>`).join("")}</div>`:""}
  <input id="q" value="${esc(q)}" placeholder="Buscar ou digitar “200 g de arroz”" autocomplete="off" enterkeyhint="search">
  <button class="btn ghost" style="margin-top:10px" data-a="newFood">＋ Cadastrar alimento</button>
  ${done.length?`<div class="lbl">Já lançado em ${esc(ml)}</div><div class="card flush">${done.map(e=>`<div class="dq"><span class="n">${esc(e.name)}<br><small class="mu">${fmt(e.qty)} ${e.unit==="unid"?"un":e.unit} · ${fmt(e.k)} kcal</small></span><button data-a="del" data-id="${e.id}" aria-label="Remover">✕</button></div>`).join("")}</div>`:""}
  <div class="lbl">${q?"Resultados":"Mais usados"}</div><div id="res">${foodList()}</div>
  ${draft.length?`<div class="sticky"><div class="in"><span>${draft.length} ${draft.length>1?"itens":"item"} · ${fmt(t)} kcal</span><button data-a="saveDraft">Salvar refeição</button></div></div>`:""}`);
}
const PFREQ=[["livre","Livre"],["diario","Diário"],["semanal","Semanal"],["mensal","Mensal"]],PDIAS={diario:1,semanal:7,mensal:30};
function pesoDue(){
  const f=S.settings.pesoFreq||"livre";if(f==="livre")return null;
  const l=pesoList(),last=l.length?l[l.length-1][0]:null;
  if(!last)return"Registre seu primeiro peso";
  const dias=Math.round((new Date(today()+"T12:00:00")-new Date(last+"T12:00:00"))/864e5);
  return dias>=PDIAS[f]?(dias===0?"Hora de pesar":"Hora de pesar · último registro há "+dias+(dias>1?" dias":" dia")):null;
}
function grpPeso(pts,f){
  if(f!=="semanal"&&f!=="mensal")return pts;
  const m=new Map();
  pts.forEach(([d,x])=>{let k=d.slice(0,7)+"-01";if(f==="semanal"){const dt=new Date(d+"T12:00:00");dt.setDate(dt.getDate()-(dt.getDay()-S.settings.semIni+7)%7);k=iso(dt)}
    const g=m.get(k)||{n:0,t:0};g.n++;g.t+=x.peso;m.set(k,g)});
  return[...m.entries()].map(([k,g])=>[k,{peso:g.t/g.n}]);
}
function pesoBlock(N){
  const lim=new Date();lim.setDate(lim.getDate()-N);const all=pesoList(),f=S.settings.pesoFreq||"livre",raw=all.filter(([d])=>d>=iso(lim)),pts=grpPeso(raw,f);
  let chart='<p class="mu" style="font-size:13px">Registre o peso em 2 dias diferentes para ver o gráfico.</p>',big="—",pill="";
  if(all.length)big=fmt(all[all.length-1][1].peso,1);
  if(raw.length>1){const a0=raw[0][1].peso,a1=raw[raw.length-1][1].peso,dif=a1-a0;pill=`${dif>0?"+":dif<0?"−":""}${fmt(Math.abs(dif),1)} kg no período`}
  if(pts.length>1){const v=pts.map(p=>p[1].peso),mn=Math.min(...v)-.4,mx=Math.max(...v)+.2,t0=new Date(pts[0][0]).getTime(),t1=new Date(pts[pts.length-1][0]).getTime()||1;
    const xy=pts.map(([d,x])=>[(new Date(d).getTime()-t0)/(t1-t0||1)*300,120-(x.peso-mn)/(mx-mn)*110]),line="M"+xy.map(p=>p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" L");
    chart=`<svg viewBox="0 0 300 130" width="100%" style="overflow:visible;margin-top:12px" role="img" aria-label="Gráfico de peso"><g stroke="var(--ln)" stroke-dasharray="3 4"><line x1="0" y1="30" x2="300" y2="30"/><line x1="0" y1="75" x2="300" y2="75"/><line x1="0" y1="120" x2="300" y2="120"/></g><path d="${line} L300 130 L0 130 Z" fill="var(--ac)" opacity=".12"/><path d="${line}" fill="none" stroke="var(--ac)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="300" cy="${xy[xy.length-1][1].toFixed(1)}" r="5" fill="var(--ac)"/></svg>`}
  const due=pesoDue(),dm=d=>d.slice(8)+"/"+d.slice(5,7)+"/"+d.slice(2,4);
  return `  <div class="card">${due?`<div class="callout" style="margin:0 0 12px"><b class="good">⚖ ${due}</b></div>`:""}<div class="mu" style="font-size:12px;margin-bottom:6px">Registrar peso</div><div class="grid2"><div class="fld"><label for="pd">Data</label><input id="pd" type="date" value="${today()}" max="${today()}"></div><div class="fld"><label for="pw">Peso (kg)</label><input id="pw" inputmode="decimal" placeholder="Ex.: 82,4"></div></div><button class="btn" style="margin-top:12px" data-a="savePeso">Salvar peso</button></div>
  <div class="card"><div class="big"><b>${big}</b><span class="mu">kg</span>${pill?`<span class="pill" style="font-size:12px">${pill}</span>`:""}</div>${chart}
  <div class="lbl" style="margin-top:16px">Com que frequência você quer se pesar?</div><div class="seg">${PFREQ.map(([k,n])=>`<button data-a="pesoFreq" data-f="${k}" class="${f===k?"on":""}">${n}</button>`).join("")}</div>
  <div class="mu" style="font-size:12px;margin-top:8px">${f==="livre"?"Registre quando quiser. O gráfico mostra cada pesagem.":f==="diario"?"O app avisa quando passar um dia sem registro.":f==="semanal"?"O app avisa a cada 7 dias e o gráfico mostra a média de cada semana.":"O app avisa a cada 30 dias e o gráfico mostra a média de cada mês."}</div></div>

  ${all.length?`<div class="lbl">Registros recentes</div><div class="card flush">${all.slice(-8).reverse().map(([d,x])=>`<div class="dq"><span class="n"><b>${fmt(x.peso,1)} kg</b><br><small class="mu">${dm(d)}</small></span><button data-a="delPeso" data-d="${d}" aria-label="Remover registro">✕</button></div>`).join("")}</div>`:""}`;
}
function vPeso(){
  const N=[7,14,30,90][hrng],pt=pesoTend();
  return page(`<h1 style="margin-bottom:12px">Peso</h1><div class="chips">${["7 dias","14 dias","30 dias","90 dias"].map((x,i)=>`<button data-a="hrng" data-i="${i}" class="${hrng===i?"on":""}">${x}</button>`).join("")}</div>${pesoBlock(N)}
  <div class="card"><b>Como o app usa seu peso</b><p class="mu" style="font-size:13px;margin:6px 0 0">No ajuste semanal, o app compara a média das 3 primeiras pesagens do período com a média das 3 últimas. A média evita que um dia de água ou sal engane. Pese-se de manhã, em jejum e no mesmo horário, e registre pelo menos 2 vezes na semana.${pt?` Média dos últimos 7 dias: <b>${fmt(pt,1)} kg</b>.`:""}</p>${hasPlan()?`<button class="btn ghost" style="margin-top:12px" data-a="ajusteOpen">Ver ajuste semanal ›</button>`:""}</div>`);
}
function vHist(){
  const N=[7,14,30,90][hrng],rows=[];
  for(let i=0;i<N;i++){const dt=new Date();dt.setDate(dt.getDate()-i);const d=iso(dt),es=ents(d);if(!es.length)continue;const D=day(d),t=sum(es),m=metaFor(D.tipo||"Descanso");rows.push({d,dt,t,m,g:D.gasto||m.gasto})}
  const n=rows.length||1,avg=f=>rows.reduce((a,r)=>a+r.t[f],0)/n,gm=rows.reduce((a,r)=>a+r.g,0)/n,bal=rows.reduce((a,r)=>a+(r.t.k-r.g),0),plan=rows.some(r=>r.m.k>0);
  return page(`<h1 style="margin-bottom:12px">Histórico</h1><div class="chips">${["7 dias","14 dias","30 dias","90 dias"].map((x,i)=>`<button data-a="hrng" data-i="${i}" class="${hrng===i?"on":""}">${x}</button>`).join("")}</div>
  <div class="grid3" style="margin-bottom:10px"><div class="mini"><small>INGERIDAS (MÉDIA)</small><b>${fmt(rows.length?avg("k"):0)}</b></div><div class="mini"><small>GASTAS (MÉDIA)</small><b>${fmt(rows.length?gm:0)}</b></div><div class="mini"><small>SALDO</small><b class="${!rows.length?"mu":bal>0?"good":"bad"}">${rows.length?(bal>0?"+":bal<0?"−":"")+fmt(Math.abs(bal)):"—"}</b></div></div>
  <div class="grid3" style="margin-bottom:14px">${[["Proteína","p"],["Carbo","c"],["Gordura","g"]].map(([nm,f])=>`<div class="mini"><small>${nm} (média)</small><b>${fmt(rows.length?avg(f):0)}</b><small style="display:inline"> g</small></div>`).join("")}</div>
  <h2 style="margin-top:6px">Dia a dia</h2><div class="card flush">${rows.map(r=>{const near=!r.m.k||Math.abs(r.t.k-r.m.k)<=150,s=r.t.k-r.g;return`<div class="hrow"><div style="width:44px"><b>${r.d.slice(8)}/${r.d.slice(5,7)}</b><div class="mu" style="font-size:11px">${r.dt.toLocaleDateString("pt-BR",{weekday:"short"})}</div></div><div class="hbar"><div><i style="width:${Math.min(100,r.t.k/3000*100)}%;background:${near?"var(--ac)":"var(--bad)"}"></i></div><small>P ${fmt(r.t.p)} · C ${fmt(r.t.c)} · G ${fmt(r.t.g)} g${r.m.k?(near?" · na meta":r.t.k>r.m.k?" · acima da meta":" · abaixo da meta"):""}</small></div><div style="text-align:right"><b>${fmt(r.t.k)} kcal</b><div class="${s>0?"good":"bad"}" style="font-size:11px;font-weight:600">${s>0?"+":s<0?"−":""}${fmt(Math.abs(s))}</div></div></div>`}).join("")||'<p class="mu" style="padding:16px">Nenhum dia lançado neste período.</p>'}</div>
  `);
}
/* ---------- Meta automática: gasto pelo peso, calibração com dados reais, revisão semanal ---------- */
const fmtData=d=>d.slice(8)+"/"+d.slice(5,7);
const diasEntre=(a,b)=>Math.round((new Date(b+"T12:00:00")-new Date(a+"T12:00:00"))/864e5);
const hasPlan=()=>{const m=S.dieta&&S.dieta.metas;return!!(m&&((m.treino&&m.treino.k>0)||(m.descanso&&m.descanso.k>0)))};
const GOALS=["Perder peso","Manter o peso","Ganhar massa"],RITMOS=["Leve","Moderado","Rápido"];
function calibrar(){
  const c=calcGasto();if(!c)return{ok:false,msg:"Complete o cadastro."};
  const hj=new Date(today()+"T12:00:00"),days=[];
  for(let i=1;i<=21;i++){const dt=new Date(hj);dt.setDate(hj.getDate()-i);days.push(iso(dt))}
  const logged=days.filter(d=>sum(ents(d)).k>600);
  if(logged.length<14)return{ok:false,msg:`Faltam ${14-logged.length} dia(s) com refeições lançadas nos últimos 21 dias.`};
  const pw=ds=>ds.map(d=>S.days[d]&&S.days[d].peso).filter(Boolean),pe=pw(days.slice(14)),pl=pw(days.slice(0,7));
  if(pe.length<2||pl.length<2)return{ok:false,msg:"Faltam pesagens: registre pelo menos 2 no início e 2 no fim das últimas 3 semanas."};
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length,dKg=avg(pl)-avg(pe),dt=14,intake=avg(logged.map(d=>sum(ents(d)).k));
  const est=avg(logged.map(d=>{const D=S.days[d]||{};return D.gasto||(D.tipo==="Treino"?c.trein:c.rest)}));
  const real=intake-dKg*7700/dt,r=Math.max(.8,Math.min(1.2,real/est));
  return{ok:true,real,est,fator:1+.6*(r-1),dKg,intake,n:logged.length};
}
function engineMeta(tipo,fator){
  const c=calcGasto(),p=S.profile,peso=c.peso,g=(tipo==="Treino"?c.trein:c.rest)*fator,goal=p.goal||0,ri=S.auto.ritmo??1;
  const pace=goal===0?[.0025,.005,.0075][ri]:goal===2?[.0015,.0025,.0035][ri]:0,raw=pace*peso*7700/7;
  const adj=goal===0?-Math.min(raw,.25*g):goal===2?Math.min(raw,.15*g):0,piso=Math.max(p.sexo==="f"?1200:1500,Math.round(c.tmb));
  let k=g+adj,limited=false;if(k<piso){k=piso;limited=true}k=Math.round(k/10)*10;
  const pr=Math.round(1.8*peso),gr=Math.round(.9*peso);
  return{k,p:pr,c:Math.max(0,Math.round((k-4*pr-9*gr)/4)),g:gr,gasto:Math.round(g),limited};
}
function novaMeta(){const cal=calibrar(),f=cal.ok?cal.fator:1;return{cal,nv:{treino:engineMeta("Treino",f),descanso:engineMeta("Descanso",f)}}}
let revPend=null;
const addDias=(d,n)=>{const t=new Date(d+"T12:00:00");t.setDate(t.getDate()+n);return iso(t)};
const pesoMedia=(a,b)=>{const w=pesoList().filter(([d])=>d>=a&&d<=b).map(([,x])=>x.peso);return w.length?w.reduce((x,y)=>x+y,0)/w.length:null};
/* Revisao semanal do plano alimentar: o plano manda; o app so SUGERE um ajuste, que so vale se voce aceitar. */
function revBaseManual(){
  const hj=today(),ini=addDias(hj,-14),ds=[...new Set(S.entries.filter(e=>!e.deleted&&e.date>=ini&&e.date<hj).map(e=>e.date))].filter(d=>sum(ents(d)).k>600).sort();
  if(!ds.length)return null;const st=ds[0];
  return{em:addDias(st,-1),peso:pesoMedia(addDias(st,-3),addDias(st,2))}}
function revInicio(pt){const em=((S.dieta&&S.dieta.em)||today()).slice(0,10);return{em,peso:pesoMedia(addDias(em,-6),em)||pt}}
function revPlano(rev,pt,hj,previa){
  const dias=diasEntre(rev.em,hj),days=[];for(let i=1;i<dias;i++)days.push(addDias(rev.em,i));
  const logged=days.filter(d=>sum(ents(d)).k>600),ws=pesoList().filter(([d])=>d>rev.em&&d<=hj).map(([d,x])=>({t:diasEntre(rev.em,d),w:x.peso})),pesos=ws.length;
  if(dias<3||logged.length<Math.ceil(dias*.6)||pesos<2)return{kind:"dados",previa,dias,logged:logged.length,pesos};
  const kw=Math.min(3,Math.floor(pesos/2)),m=a=>({w:a.reduce((x,y)=>x+y.w,0)/a.length,t:a.reduce((x,y)=>x+y.t,0)/a.length}),A=m(ws.slice(0,kw)),B=m(ws.slice(-kw));
  if(B.t-A.t<2)return{kind:"dados",previa,dias,logged:logged.length,pesos};
  rev={...rev,peso:A.w};pt=B.w;const span=B.t-A.t;
  const goal=(S.profile&&S.profile.goal)||0,ri=S.auto.ritmo??1;
  const pace=goal===0?[.0025,.005,.0075][ri]:goal===2?[.0015,.0025,.0035][ri]:0,alvo=(goal===0?-1:1)*pace*pt;
  const real=(pt-rev.peso)/(span/7),intake=logged.reduce((a,d)=>a+sum(ents(d)).k,0)/logged.length;
  let delta=Math.round((alvo-real)*7700/7/10)*10;delta=Math.max(-150,Math.min(150,delta));
  const ok=Math.abs(delta)<80,dm=S.dieta.metas,nv={},piso=S.profile&&S.profile.sexo==="f"?1200:1500;
  for(const t of["treino","descanso"]){const m=dm[t];if(!m||!(m.k>0))continue;
    const k=Math.max(Math.min(piso,m.k),m.k+(ok?0:delta)),d=k-m.k;let p=m.p,c=m.c,g=m.g;
    if(!ok){
      let dp=0;
      if(goal===0&&d<0&&p/pt<2.6)dp=10;
      else if(goal!==0&&p/pt<1.6)dp=Math.min(30,Math.ceil(1.6*pt-p));
      const rest=d-4*dp,cs=goal===2?.8:.7;
      p+=dp;c=Math.max(40,c+cs*rest/4);g=Math.max(30,g+(1-cs)*rest/9);
      const gmin=goal===0?.15*k/9:.5*pt;
      if(g<gmin){c=Math.max(40,c-(gmin-g)*9/4);g=gmin}}
    nv[t]={k:Math.round(k),p:Math.round(p),c:Math.round(c),g:Math.round(g),gasto:m.gasto}}
  const nota=ok?"":goal===0?(delta<0?"Ponto de partida comum ao secar mais: proteína um pouco mais alta (+10 g) e o resto da redução saindo de carboidrato (70%) e gordura (30%).":"Você está perdendo mais rápido que o alvo: a diferença de calorias volta principalmente como carboidrato (70%) e gordura (30%)."):goal===2?(delta>0?"Ponto de partida comum ao ganhar massa: proteína dentro de 1,6 a 2,2 g/kg e as calorias a mais indo principalmente para carboidrato (80%), o restante para gordura.":"Você está ganhando mais rápido que o alvo: a redução sai principalmente do carboidrato (80%) e um pouco da gordura."):"Para manter o peso, a diferença de calorias é dividida entre carboidrato (70%) e gordura (30%).";
  return{kind:"plano",previa,nota,dias,kw,peso:pt,pesoIni:rev.peso,real,alvo,intake,n:logged.length,ok,goal,ri,nv,old:dm};
}
let revEdit={},trDraft=null,sdDraft=null;
function revDica(n,peso,goal){
  const pk=n.p/peso,ck=n.c/peso,gk=n.g/peso,gp=n.k>0?n.g*9/n.k*100:0,pz=S.profile&&S.profile.sexo==="f"?1200:1500,f1=v=>fmt(v,1);
  const L=(txt,ruim)=>`<div class="${ruim?"bad":"mu"}" style="font-size:12px;margin-top:4px">${txt}</div>`;
  let pm,pr=false,gm,gr=false,cm,cr=false;
  if(goal===0){
    if(pk<1.6){pm="abaixo do usual (1,6 a 2,2 g/kg)";pr=true}else if(pk<=2.2)pm="faixa mais usada (1,6 a 2,2 g/kg)";else if(pk<=3.2)pm="faixa alta, usada em déficit por quem já é magro e treina";else{pm="acima do que os estudos mostram ser útil (até cerca de 3,2 g/kg)";pr=true}
    if(gp<15){gm="abaixo de 15% das calorias (faixa estudada: 15 a 30%)";gr=true}else if(gp>30){gm="acima de 30% das calorias (faixa estudada: 15 a 30%)";gr=true}else gm="dentro de 15 a 30% das calorias";
    cm="o que sobra das calorias"}
  else{
    if(pk<1.6){pm="abaixo do usual (1,6 a 2,2 g/kg)";pr=true}else if(pk<=2.2)pm="dentro da faixa estudada (1,6 a 2,2 g/kg)";else{pm="acima da faixa estudada (1,6 a 2,2 g/kg); sem benefício extra comprovado para ganho de massa";pr=true}
    if(gk<.5){gm="abaixo de 0,5 g/kg (faixa estudada: 0,5 a 1,5)";gr=true}else if(gk>1.5){gm="acima de 1,5 g/kg (faixa estudada: 0,5 a 1,5)";gr=true}else gm="dentro de 0,5 a 1,5 g/kg";
    if(ck<3){cm="abaixo de 3 g/kg, mínimo sugerido para sustentar o treino";cr=true}else cm="a partir de 3 g/kg, suficiente para o treino"}
  return L(`Proteína: <b>${f1(pk)} g/kg</b> · ${pm}`,pr)+L(`Gordura: <b>${f1(gk)} g/kg</b> (${fmt(gp)}% das calorias) · ${gm}`,gr)+L(`Carboidrato: <b>${f1(ck)} g/kg</b> · ${cm}`,cr)+(n.k<pz?L(`Abaixo do piso de segurança de ${fmt(pz)} kcal.`,true):"")}
function revRefresh(){autoTick();const r=revPend;if(!r||r.kind!=="plano"||r.ok)return;for(const t in r.nv){const k=document.getElementById("rvk_"+t),h=document.getElementById("rvh_"+t);if(k)k.textContent=fmt(r.nv[t].k)+" kcal";if(h)h.innerHTML=revDica(r.nv[t],r.peso,r.goal)}}
function revEditAplicar(r){if(!r||r.kind!=="plano"||r.ok)return;for(const t in r.nv){const n=r.nv[t],b={...n};let ch=false;for(const m of["p","c","g"]){const v=revEdit[t+m];if(v!=null){n[m]=v;ch=true}}if(ch)n.k=Math.round(b.k+4*(n.p-b.p)+4*(n.c-b.c)+9*(n.g-b.g))}}
function autoTick(){
  revPend=null;const a=S.auto,c=calcGasto();if(!c||!pesoList().length)return;
  const hj=today();
  if(hasPlan()){
    const pt=pesoTend();if(!pt)return;
    if(!a.rev){a.rev=revInicio(pt);save();queueState()}
    if(revForce){const b=revBaseManual();revPend=b?revPlano(b,pt,hj,true):{kind:"dados",previa:true,dias:0,logged:0,pesos:0};revEditAplicar(revPend);return}
    if(diasEntre(a.rev.em,hj)<8)return;
    revPend=revPlano(a.rev,pt,hj);revEditAplicar(revPend);return}
  if(!a.on)return;
  if(a.lastRev&&diasEntre(a.lastRev,hj)<7)return;
  const{cal,nv}=novaMeta(),old=a.applied;
  if(old&&Math.abs(nv.treino.k-old.treino.k)<40&&Math.abs(nv.descanso.k-old.descanso.k)<40){a.lastRev=hj;save();queueState();return}
  revPend={kind:"auto",nv,old,cal,peso:c.peso};
}
const sgn=v=>(v>0?"+":v<0?"−":"")+fmt(Math.abs(v));
function revBanner(){
  const r=revPend;if(!r&&!hasPlan())return"";
  const a=S.auto,prox=hasPlan()&&a.rev?fmtData(addDias(a.rev.em,8)):"";
  const sub=!r?"Toque para ver uma prévia"+(prox?" · próxima sugestão em "+prox:""):r.kind==="plano"?(r.ok?"Você está no ritmo do seu objetivo":"Sugestão disponível para esta semana"):r.kind==="dados"?"Faltam dados para recalcular":"Nova meta estimada disponível";
  return`<div class="card flush rev"><button class="row" data-a="ajusteOpen"><span class="n"><b>Ajuste semanal</b><small>${sub}</small></span><span class="mu">›</span></button></div>`}
function vAjuste(){return page(revPend?revCard():`<h1>Ajuste semanal</h1><p class="mu">${hasPlan()?"Registre o peso e as refeições para ver uma sugestão.":"Importe o seu plano alimentar em Ajustes para usar o ajuste semanal."}</p>`,{back:"hoje"})}
function revCard(){
  const r=revPend;if(!r)return"";
  if(r.kind==="dados")return`<div class="card rev"><b>Ajuste semanal${r.previa?" · prévia":""}</b><p>${r.previa?"Com os dias que você já tem":"Já se passaram "+r.dias+" dias"}, faltam dados para recalcular: ${r.logged} dia(s) com refeições lançadas e ${r.pesos} pesagem(ns) no período. Lance as refeições e pese-se com regularidade para o ajuste ser confiável. Seu plano continua valendo.</p>${r.previa?"":`<div class="frow"><button class="btn ghost" data-a="revKeep">Pular este ajuste</button></div>`}</div>`;
  if(r.kind==="plano"){const dk=r.peso-r.pesoIni,sem=r.real,f1=v=>(v>0?"+":v<0?"−":"")+fmt(Math.abs(v),1),T=r.nv.treino,D=r.nv.descanso,O=r.old,
    ed=(tp,n,o)=>n?`<div class="lbl" style="margin:12px 0 6px">${tp==="treino"?"Dia de treino":"Dia de descanso"} · <b id="rvk_${tp}">${fmt(n.k)} kcal</b> <span class="mu">(antes ${fmt(o.k)})</span></div><div class="grid3">${[["p","Prot. (g)"],["c","Carbo (g)"],["g","Gord. (g)"]].map(([m,l])=>field("rv_"+tp+"_"+m,l,String(n[m]),"",'inputmode="decimal"')).join("")}</div><div id="rvh_${tp}">${revDica(n,r.peso,r.goal)}</div>`:"";
    return`<div class="card rev"><b>Ajuste semanal${r.previa?" · prévia":""}</b><p>Em ${r.dias} dias seu peso foi de <b>${fmt(r.pesoIni,1)}</b> para <b>${fmt(r.peso,1)} kg</b> (${f1(dk)} kg, ${f1(sem)} kg por semana). Você comeu em média <b>${fmt(r.intake)} kcal</b> nos ${r.n} dias lançados.</p><p class="mu" style="font-size:12px;margin:6px 0 0">Como é calculado: média das ${r.kw>1?r.kw+" primeiras pesagens":"primeira pesagem"} do período comparada com a média das ${r.kw>1?r.kw+" últimas":"última"}. A média evita que um dia de água ou sal engane.</p>
    <div class="mu" style="font-size:12px;margin:8px 0">Seu objetivo (toque para mudar)</div><div class="seg">${GOALS.map((n,i)=>`<button data-a="revGoal" data-i="${i}" class="${r.goal===i?"on":""}">${n}</button>`).join("")}</div>
    ${r.goal!==1?`<div class="mu" style="font-size:12px;margin:10px 0 8px">Ritmo</div><div class="seg">${RITMOS.map((n,i)=>`<button data-a="autoRitmo" data-i="${i}" class="${r.ri===i?"on":""}">${n}</button>`).join("")}</div><p class="mu" style="font-size:12px;margin:8px 0 0">Alvo: ${r.goal===0?"perder":"ganhar"} cerca de ${fmt(Math.abs(r.alvo),2)} kg por semana.</p>`:`<p class="mu" style="font-size:12px;margin:8px 0 0">Alvo: manter o peso.</p>`}
    ${r.ok?`<p style="margin-top:10px"><b>Você está no ritmo do seu objetivo.</b> Sugestão: manter o plano como está.</p><div class="frow"><button class="btn" data-a="revKeep">Manter o plano</button></div>`:`<p style="margin-top:10px"><b>Sugestão de ajuste.</b> ${r.nota} <b>Toque em qualquer valor para mudar</b>; as calorias se ajustam sozinhas. As faixas abaixo vêm de revisões científicas (ISSN 2017 e 2026, Helms 2014, Iraki 2019) e são referências, não regras. Se tiver dúvida, confirme com sua nutricionista.</p>${ed("treino",T,O.treino)}${ed("descanso",D,O.descanso)}<div class="frow" style="margin-top:12px"><button class="btn" data-a="revApply">Aplicar ao plano</button><button class="btn ghost" data-a="revKeep">Manter o plano</button></div><p class="mu" style="font-size:12px;margin:8px 0 0">Dá para voltar às metas originais em Ajustes. Se tiver dúvida, confirme com sua nutricionista.</p>`}</div>`}
  const o=r.old,d=r.nv.descanso,t=r.nv.treino;
  return`<div class="card rev"><b>Ajuste semanal da meta</b><p>Seu peso médio da semana é ${fmt(r.peso,1)} kg. Nova meta estimada: <b>${fmt(d.k)} kcal</b> em dia de descanso e <b>${fmt(t.k)} kcal</b> em dia de treino${o?` (antes: ${fmt(o.descanso.k)} e ${fmt(o.treino.k)})`:""}.</p>${r.cal.ok?`<p class="mu">Calibrada com seus dados: gasto real estimado de ${fmt(r.cal.real)} kcal por dia.</p>`:""}<div class="frow"><button class="btn" data-a="revApply">Atualizar</button><button class="btn ghost" data-a="revKeep">Manter a atual</button></div></div>`;
}
function vAuto(){
  const c=calcGasto(),a=S.auto,goal=(S.profile&&S.profile.goal)||0,pt=pesoTend(),cal=c?calibrar():{ok:false,msg:"Complete o cadastro."},ap=a.applied;
  const lk=(k,v)=>`<div class="calc"><span>${k}</span><b>${v}</b></div>`;
  return page(`<h1>Meta automática</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">Uma estimativa do quanto comer, calculada pelo seu peso, seu gasto e seu objetivo. Não substitui a orientação de um nutricionista.</p>
  ${hasPlan()?"":`<div class="card flush"><button class="row" data-a="autoToggle"><span class="n"><b>Usar meta automática</b><small>${a.on?"Ligada: a meta aparece na Nutrição":"Desligada: o app só mostra o que você ingeriu"}</small></span><span class="tg ${a.on?"on":""}"></span></button></div>`}
  ${hasPlan()?`<div class="card"><b>Seu plano alimentar manda</b><p class="mu" style="font-size:13px;margin:6px 0 0">As metas de calorias e macros da tela Hoje e do histórico são sempre as do seu plano. Toda semana o app compara seu peso e o que você comeu com o seu objetivo e <b>sugere</b> um ajuste. Nada muda sem você aceitar.${a.rev?` Próximo ajuste: <b>${fmtData(addDias(a.rev.em,8))}</b>, com 7 dias completos.`:""}</p><div class="fld" style="margin-top:12px"><label for="rv_ini">Primeiro dia do acompanhamento</label><input id="rv_ini" type="date" value="${a.rev?addDias(a.rev.em,1):""}" max="${today()}"></div>${S.dieta.metasPlano?`<button class="btn ghost" style="margin-top:12px" data-a="revReset">Voltar às metas originais do plano</button>`:""}</div>`:""}
  <div class="card"><div class="mu" style="font-size:12px;margin-bottom:6px">Seu objetivo (do cadastro)</div><b>${GOALS[goal]}</b>${goal!==1?`<div class="mu" style="font-size:12px;margin:14px 0 8px">Ritmo</div><div class="seg">${RITMOS.map((n,i)=>`<button data-a="autoRitmo" data-i="${i}" class="${(a.ritmo??1)===i?"on":""}">${n}</button>`).join("")}</div><div class="mu" style="font-size:12px;margin-top:8px">${goal===0?"Perda de cerca de "+["0,25%","0,5%","0,75%"][a.ritmo??1]+" do peso por semana.":"Ganho de cerca de "+["0,15%","0,25%","0,35%"][a.ritmo??1]+" do peso por semana."}</div>`:""}</div>
  ${a.on&&ap?`<div class="card"><div class="lbl" style="margin-top:0">Meta atual</div>${lk("Dia de descanso",fmt(ap.descanso.k)+" kcal")}${lk("Dia de treino",fmt(ap.treino.k)+" kcal")}${lk("Proteína · Carbo · Gordura",fmt(ap.descanso.p)+" · "+fmt(ap.descanso.c)+" · "+fmt(ap.descanso.g)+" g")}${ap.descanso.limited||ap.treino.limited?`<p class="mu" style="font-size:12px;margin:8px 0 0">Limitada pelo piso de segurança (taxa metabólica basal).</p>`:""}<p class="mu" style="font-size:12px;margin:8px 0 0">Atualizada em ${ap.em?ap.em.slice(8)+"/"+ap.em.slice(5,7):"—"}. Os macros acima são do dia de descanso.</p><button class="btn ghost" style="margin-top:12px" data-a="autoNow">Recalcular agora</button></div>`:""}
  <div class="card"><div class="lbl" style="margin-top:0">Seus dados</div>${lk("Peso médio (7 dias)",pt?fmt(pt,1)+" kg":"—")}${c?lk("Gasto estimado, descanso",fmt(c.rest)+" kcal")+lk("Gasto estimado, treino",fmt(c.trein)+" kcal"):""}${cal.ok?lk("Gasto real estimado",fmt(cal.real)+" kcal")+`<p class="mu" style="font-size:12px;margin:8px 0 0">Calculado pelo que você comeu e pela variação do seu peso em 3 semanas. Vale se você lançou tudo o que comeu.</p>`:`<p class="mu" style="font-size:12px;margin:8px 0 0">Calibração com seus dados: ${esc(cal.msg)}</p>`}</div>
  <div class="card"><div class="lbl" style="margin-top:0">Como o cálculo é feito</div>
  <p class="how"><b>1. Gasto do dia.</b> Fórmula de Mifflin-St Jeor: 10 × peso (kg) + 6,25 × altura (cm) − 5 × idade, somando 5 para homens ou subtraindo 161 para mulheres. Esse valor (taxa metabólica basal) é multiplicado por 1,2 para o dia a dia. Nos dias de treino entra também o gasto do treino, conforme o seu Plano de gasto. O peso usado é a <b>média dos últimos 7 dias</b>.</p>
  <p class="how"><b>2. Ajuste com os seus dados.</b> Com pelo menos 14 dias de refeições lançadas nas últimas 3 semanas e pesagens no começo e no fim, o app calcula o gasto real: média de calorias ingeridas menos (variação do peso em kg × 7.700 ÷ 14 dias). O gasto estimado é corrigido em 60% da diferença, no máximo 20% para cima ou para baixo.</p>
  <p class="how"><b>3. Meta de calorias.</b> Gasto do dia, menos um déficit se o objetivo é perder peso (0,25%, 0,5% ou 0,75% do peso por semana, conforme o ritmo, até no máximo 25% do gasto), ou mais um superávit se é ganhar massa (0,15%, 0,25% ou 0,35%, até 15%). Para manter o peso, a meta é o próprio gasto. O valor é arredondado de 10 em 10 e nunca fica abaixo da taxa metabólica basal, nem de 1.500 kcal (homens) ou 1.200 kcal (mulheres).</p>
  <p class="how"><b>4. Macros.</b> Proteína 1,8 g por kg, gordura 0,9 g por kg e o restante em carboidrato.</p>
  <p class="how"><b>5. Quando a meta muda.</b> Sem plano alimentar, a cada 7 dias o app recalcula usando a média do peso e, se a meta mudar 40 kcal ou mais, avisa na tela inicial. <b>Nada muda sem a sua confirmação.</b></p>
  <p class="how"><b>Plano alimentar.</b> Quem tem plano importado sempre usa as metas do plano. Toda semana o app compara a variação do seu peso (média de 7 dias) com o ritmo do seu objetivo e, se estiver fora, sugere mudar as calorias em até 150 kcal por semana, e propõe um ponto de partida conforme o objetivo (ao secar mais: um pouco mais de proteína e menos carboidrato e gordura; ao ganhar massa: mais carboidrato). Você pode mudar qualquer macro antes de aplicar. Só passa a valer se você aceitar, e dá para voltar às metas originais. Exige refeições lançadas em pelo menos 60% dos dias e 2 pesagens no período.</p>
  <p class="mu" style="font-size:12px;margin:10px 0 0">É uma estimativa e não substitui a orientação de um nutricionista.</p></div>`,{back:"ajustes"});
}
function vCalc(tab){
  const c=calcGasto(),pl=S.settings.plan;if(!c)return page(`<p>Preencha o cadastro primeiro.</p><button class="btn" data-a="go" data-v="cad">Abrir cadastro</button>`,tab?{}:{back:"ajustes"});
  return page(`<h1>Gasto calórico</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">Conte como é o seu treino e o app calcula quanto você gasta por dia.</p>
  <div class="card"><div class="mu" style="font-size:12px;margin-bottom:8px">Treinos por semana</div><div class="days">${[0,1,2,3,4,5,6,7].map(n=>`<button data-a="plan" data-k="dias" data-v="${n}" class="${pl.dias===n?"on":""}">${n}</button>`).join("")}</div>
  <div class="mu" style="font-size:12px;margin:16px 0 8px">Minutos por treino</div><div class="row" style="border:0;padding:0"><button class="back" style="margin:0;width:44px;height:44px" data-a="min" data-n="-10">−</button><div style="flex:1;text-align:center;font-size:24px;font-weight:700">${pl.min} <small class="mu" style="font-size:13px;font-weight:400">min</small></div><button class="back" style="margin:0;width:44px;height:44px" data-a="min" data-n="10">＋</button></div>
  <div class="mu" style="font-size:12px;margin:16px 0 8px">Intensidade</div><div class="seg">${["Leve","Moderada","Intensa"].map((n,i)=>`<button data-a="plan" data-k="int" data-v="${i}" class="${pl.int===i?"on":""}">${n}</button>`).join("")}</div></div>
  <div class="grid2"><div class="mini"><small>DIA DE DESCANSO</small><b style="font-size:26px">${fmt(c.rest)}</b><small>kcal</small></div><div class="mini" style="background:var(--ac);color:var(--acf)"><small style="color:var(--acf)">DIA DE TREINO</small><b style="font-size:26px">${fmt(c.trein)}</b><small style="color:var(--acf)">kcal</small></div></div>
  <div class="card" style="margin-top:12px"><div class="calc"><span>Metabolismo basal</span><b>${fmt(c.tmb)} kcal</b></div><div class="calc"><span>Gasto do treino</span><b>+${fmt(c.extra)} kcal</b></div></div>
  <p class="mu" style="font-size:12px;text-align:center">Fórmula de Mifflin-St Jeor. É uma estimativa do gasto, não uma recomendação de quanto comer.</p>`,tab?{}:{back:"ajustes"});
}
function vCad(){
  const p=S.profile||{};
  return page(`<h1>Cadastro</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">Usamos estes dados para calcular o seu gasto calórico.</p><div class="card grid2">${field("c_nome","Nome",p.nome,"",'maxlength="30"').replace('class="fld"','class="fld" style="grid-column:1/-1"')}${field("c_idade","Idade",p.idade,"",'inputmode="numeric"')}${field("c_alt","Altura (cm)",p.alt,"",'inputmode="numeric"')}${field("c_peso","Peso (kg)",p.peso?fmt(p.peso,1):"","",'inputmode="decimal"')}<div class="fld"><label>Sexo</label><div class="seg"><button data-a="sexoC" data-s="m" class="${p.sexo!=="f"?"on":""}">M</button><button data-a="sexoC" data-s="f" class="${p.sexo==="f"?"on":""}">F</button></div></div></div>
  <div class="lbl">Objetivo</div>${["Perder peso","Manter o peso","Ganhar massa"].map((g,i)=>`<button class="pick ${(p.goal||0)===i?"on":""}" data-a="goalC" data-i="${i}">${g}</button>`).join("")}<button class="btn" style="margin-top:10px" data-a="saveCad">Salvar cadastro</button>`,{back:"ajustes"});
}
function vConta(){
  return page(`<h1>Conta</h1>${S.session?`<div class="card"><div class="mu" style="font-size:12px">Conectado como</div><b>${esc(S.session.email)}</b></div><button class="btn ghost" data-a="syncNow">Sincronizar agora</button><button class="lk" data-a="logout" style="display:block;margin:10px auto 0">Sair da conta</button>`:Cloud.on()?`<p class="mu">Entre para sincronizar seus dados entre aparelhos.</p>${field("a_email","E-mail","","voce@email.com",'type="email" autocomplete="email" autocapitalize="off"')}<div style="height:10px"></div>${field("a_pw","Senha (mín. 8 caracteres)","","",'type="password" autocomplete="current-password"')}<div style="height:14px"></div><button class="btn" data-a="login">Entrar</button><button class="btn ghost" style="margin-top:8px" data-a="signup">Criar conta</button>`:`<p class="mu">A nuvem não está configurada. Preencha <b>config.js</b> com os dados do Supabase (veja o README).</p>`}`,{back:"ajustes"});
}
function vLogin(){return `<div class="scroll" style="display:flex;flex-direction:column;justify-content:center"><div class="logo">P</div><div class="hero">Entre na sua conta</div><p class="mu">Seus dados ficam guardados na nuvem e protegidos por login.</p>${field("a_email","E-mail","","voce@email.com",'type="email" autocomplete="email" autocapitalize="off"')}<div style="height:10px"></div>${field("a_pw","Senha","","",'type="password" autocomplete="current-password"')}<div style="height:16px"></div><button class="btn" data-a="login">Entrar</button><button class="btn ghost" style="margin-top:8px" data-a="firstTime">Primeira vez? Criar conta</button><button class="lk" data-a="localOnly">Continuar só neste aparelho</button></div>`}
function vImport(){return page(`<h1>Importar do app antigo</h1><p class="mu" style="font-size:13px;margin:4px 0 16px">Cole o endereço do script (termina em /exec) e o token que estão em Ajustes do app antigo. Lançamentos, peso, treinos e alimentos são copiados. Rodar de novo não duplica.</p>${field("i_url","Endereço do script","","https://script.google.com/macros/s/.../exec",'autocapitalize="off" autocomplete="off"')}<div style="height:10px"></div>${field("i_tok","Token","","",'type="password" autocomplete="off"')}<div style="height:14px"></div><button class="btn" id="i_go" data-a="runImport">Importar</button><p class="mu" id="i_msg" style="margin-top:12px;font-size:13px"></p>`,{back:"ajustes"})}
function vSetPin(){return page(`<h1>Novo PIN</h1><p class="mu">Digite 4 dígitos.</p>${pad()}`,{back:"ajustes"})}
function vAjustes(){
  const tg=(a,on,n,s)=>`<button class="row" data-a="${a}"><span class="n"><b>${n}</b><small>${s}</small></span><span class="tg ${on?"on":""}"></span></button>`;
  const lk=(a,v,n,r="›")=>`<button class="row" data-a="${a}" data-v="${v||""}"><span class="n">${n}</span><span class="mu">${r}</span></button>`;
  const c=calcGasto();
  return page(`<h1 style="margin-bottom:14px">Ajustes</h1><div class="lbl" style="margin-top:0">Segurança</div><div class="card flush">${tg("tgPin",!!S.settings.pinHash,"Bloqueio por PIN","Pede o PIN ao abrir o app")}${tg("tgLem",S.settings.lembrete,"Lembretes e avisos",S.settings.lembrete&&S.settings.pushOn?"Refeições, peso e check-up, mesmo com o app fechado":"Refeições, só com o app aberto. Entre na conta para avisos com o app fechado")}${lk("go","avisos","Horários dos avisos")}${tg("tgWifi",S.settings.wifi,"Sincronizar só no Wi-Fi","Economiza dados móveis")}</div>
  <div class="lbl">Metas</div><div class="card flush">${lk("go","plano","Plano alimentar",S.dieta?"importado ›":"›")}${lk("go","auto","Meta automática",hasPlan()?"plano manda ›":S.auto.on?"automática ligada ›":"desligada ›")}${lk("go","calc","Calculadora de gasto",c?fmt(c.rest)+" kcal ›":"›")}${lk("go","cad","Cadastro",esc(S.profile?.nome||"")+" ›")}</div>
  <div class="lbl">Dados</div><div class="card flush">${lk("go","conta","Conta",esc(S.session?S.session.email:"Neste aparelho")+" ›")}${lk("exportCsv","","Exportar lançamentos (CSV)")}<label class="row" style="cursor:pointer"><span class="n">Importar alimentos (CSV)<small>Colunas: Alimento;Grupo;Unidade;Porção;Kcal;P;C;G</small></span><input type="file" id="csv" accept=".csv,text/csv" hidden><span class="mu">›</span></label>${lk("wipe","","<span class='bad'>Apagar dados deste aparelho</span>")}</div>
  ${devOn?`<div class="lbl">Ferramentas avançadas</div><div class="card flush">${lk("go","import","Importar do app antigo")}${lk("go","finimp","Importar finanças (JSON)")}</div>`:""}<p class="mu" style="font-size:12px;text-align:center;margin-top:16px">${S.outbox.length?S.outbox.length+" alteração(ões) aguardando envio":"Tudo enviado"} · <span data-a="verTap">versão 3.0</span></p>`,{back:"inicio"});
}

function vTreino(){
  const D=day(cur),tipo=D.tipo||"Descanso",m=metaFor(tipo),t=sum(ents(cur)),g=D.gasto||m.gasto,s=t.k-g,has=t.k>0,dt=new Date(cur+"T12:00:00");
  const sg=s>0?"+":s<0?"−":"";
  return page(`<div class="top"><div><div class="mu">${cur===today()?"Hoje, ":""}${dt.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div><h1>Treino</h1></div><span class="chip"><i class="dot ${stat.ok?"ok":""}"></i>${esc(stat.t)}</span></div>
  <div class="dnav"><button data-a="day" data-n="-1" aria-label="Dia anterior">‹</button><div class="seg"><button data-a="tipo" data-t="Descanso" class="${tipo==="Descanso"?"on":""}">Descanso</button><button data-a="tipo" data-t="Treino" class="${tipo==="Treino"?"on":""}">Treino</button></div><button data-a="day" data-n="1" aria-label="Próximo dia" ${cur>=today()?"disabled style='opacity:.3'":""}>›</button></div>
  <div class="card"><div class="lbl" style="margin-top:0">Balanço do dia</div><div class="grid3"><div class="mini"><small>Ingeridas</small><b>${fmt(t.k)}</b><small style="display:inline"> kcal</small></div><div class="mini"><small>Gastas</small><b>${fmt(g)}</b><small style="display:inline"> kcal</small></div><div class="mini"><small>${cur===today()?"Saldo parcial":"Saldo"}</small><b class="${has?(s>0?"good":"bad"):"mu"}">${has?sg+fmt(Math.abs(s)):"—"}</b></div></div>
  <div class="mu" style="font-size:13px;margin-top:12px">${has?(cur===today()?"Até agora: ":"")+(s>0?"superávit de "+fmt(s)+" kcal.":s<0?"déficit de "+fmt(-s)+" kcal.":"saldo zerado.").replace(/^./,c=>cur===today()?c:c.toUpperCase()):"Lance as refeições em Nutrição para ver o saldo."}</div></div>
  <div class="card"><div class="fld"><label for="tr_nome">Treino do dia</label><div class="row" style="border:0;padding:0"><input id="tr_nome" value="${esc(D.treino||"")}" maxlength="80" placeholder="Ex.: Peito e tríceps, corrida 5 km"><button class="btn" style="width:auto;padding:14px 20px" data-a="saveTreino">Salvar</button></div></div></div>
  ${(()=>{const T=S.treinos||[],sel=T.find(x=>x.nome===D.treino);return`${sel?`<div class="rh"><h2>${esc(sel.nome)}</h2><button class="lk" data-a="trEdit" data-id="${sel.id}">Editar</button></div>${trLista(sel)}`:""}
  <div class="rh"><h2>Meus treinos</h2><button class="lk" data-a="trNew">＋ Novo</button></div>${T.length?`<div class="card flush">${T.map(x=>`<div class="dq"><button class="row" style="flex:1;border:0;padding:0" data-a="trUse" data-id="${x.id}"><span class="n"><b>${esc(x.nome)}</b><small>${x.ex.length} exerc. · toque para usar neste dia</small></span><span class="mu">${x.nome===D.treino?"✓":""}</span></button><button class="lk" data-a="trEdit" data-id="${x.id}" aria-label="Editar">✎</button></div>`).join("")}</div>`:`<p class="mu" style="font-size:13px">Salve aqui seus treinos com exercícios, séries, repetições, carga e intervalo. Depois é só tocar para usar no dia.</p>`}`})()}
  <div class="card" style="margin-top:12px"><div class="fld"><label for="gw">Gasto do dia (Apple Watch ou outro monitor)</label><div class="row" style="border:0;padding:0"><input id="gw" inputmode="numeric" value="${D.gasto||""}" placeholder="Estimado: ${fmt(m.gasto)} kcal"><button class="btn" style="width:auto;padding:14px 20px" data-a="saveGasto">Salvar</button></div></div><div class="mu" style="font-size:12px;margin-top:8px">${D.gasto?"Usando o gasto que você informou.":"Sem valor: usando o gasto estimado pela Calculadora de gasto (aba Plano)."} Se você usa um monitor, como o Apple Watch, informe o total do dia (ativas + em repouso). Se preferir não informar, o app usa a estimativa da calculadora. Você também pode digitar aqui qualquer outro dado de gasto que tenha.</div></div>
  ${weekSummary()}`);
}
/* ---------- Saúde: check-ups com exames (valores e faixas), aviso de 1 ano ---------- */
const EXAMES=[["Glicose em jejum","mg/dL",/glicose|glicemia(?! media)/],["Hemoglobina glicada (HbA1c)","%",/hemoglobina glicada|hba1c|hemoglobina glicosilada/],["Colesterol total","mg/dL",/colesterol total/],["HDL","mg/dL",/\bhdl\b/],["LDL","mg/dL",/\bldl\b/],["Triglicerídeos","mg/dL",/triglicer/],["TSH","µUI/mL",/\btsh\b/],["T4 livre","ng/dL",/t4 livre/],["Vitamina D (25-OH)","ng/mL",/vitamina d|25.?hidroxi/],["Vitamina B12","pg/mL",/vitamina b12|\bb12\b/],["Ferritina","ng/mL",/ferritina/],["Ferro sérico","µg/dL",/ferro (serico|total)|^ferro\b/],["Hemoglobina","g/dL",/hemoglobina(?! glic)/],["Hematócrito","%",/hematocrito/],["Leucócitos","/mm³",/leucocitos/],["Plaquetas","/mm³",/plaquetas/],["Creatinina","mg/dL",/creatinina/],["Ureia","mg/dL",/ureia/],["TGO (AST)","U/L",/\btgo\b|\bast\b|transaminase oxalacetica/],["TGP (ALT)","U/L",/\btgp\b|\balt\b|transaminase piruvica/],["Gama GT","U/L",/gama.?gt|gama glutamil|\bggt\b/],["Ácido úrico","mg/dL",/acido urico/],["PCR (proteína C reativa)","mg/L",/proteina c reativa|\bpcr\b/],["Testosterona total","ng/dL",/testosterona total|^testosterona\b/],["Insulina em jejum","µUI/mL",/insulina/]];
const nrm=t=>t.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const n2=x=>{const v=parseFloat(String(x).replace(/\./g,m=>/^\d{1,3}(\.\d{3})+(,|$)/.test(x)?"":".").replace(",","."));return isNaN(v)?null:v};
function parseExames(tx){
  const L=tx.split("\n").map(x=>x.trim()),out=[],used=new Set();
  for(const[nome,un,re]of EXAMES){
    for(let i=0;i<L.length;i++){
      if(used.has(i))continue;const ln=nrm(L[i]),mt=ln.match(re);if(!mt||mt.index>25)continue;
      const rest=ln.slice(mt.index+mt[0].length).replace(/\(?25.?(?:oh|hidroxi\w*)\)?/g," "),mv=rest.match(/^[^\d\n]{0,45}?(\d+(?:[.,]\d+)?)/);if(!mv)continue;
      const v=n2(mv[1]);if(v==null)continue;used.add(i);
      const after=rest.slice(mv.index+mv[0].length),refTxt=after;
      let mn="",mx="",r;
      if(r=refTxt.match(/(\d+(?:[.,]\d+)?)\s*(?:a|-|–|ate)\s*(\d+(?:[.,]\d+)?)/)){mn=n2(r[1]);mx=n2(r[2]);if(mn!=null&&mx!=null&&mn>mx){mn="";mx=""}}
      else if(r=refTxt.match(/(?:inferior a|menor que|menor ou igual a|ate|<=?)\s*(\d+(?:[.,]\d+)?)/))mx=n2(r[1]);
      else if(r=refTxt.match(/(?:superior a|maior que|acima de|>=?)\s*(\d+(?:[.,]\d+)?)/))mn=n2(r[1]);
      out.push({n:nome,u:un,v,min:mn,max:mx});break}}
  return out}
const SIGLAS=new Set(["fsh","lh","shbg","dht","t3","t4","tsh","hdl","ldl","vldl","b12","hba1c","a1c","psa","tgo","tgp","ast","alt","pcr","hcm","vcm","chcm","rdw"]);
const SKIPT=/^(valor|valores|nota|metodo|material|observ|atencao|resultado|exame|liberado|realizado|adultos|homem|mulher|criancas|pediatr|gestante)/;
function titulo(h){return h.toLowerCase().replace(/[a-zà-ÿ0-9]+/g,w=>SIGLAS.has(nrm(w))?w.toUpperCase():w).replace(/^./,c=>c.toUpperCase())}
function parseLaudo(tx,sexo,idade){
  const L=tx.split("\n").map(x=>x.replace(/\s+/g," ").trim()),out=[],NUM="(\\d+(?:[.,]\\d+)?)";
  const HEAD=/^[A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 ,\-\(\)\/\.']{3,70}$/,isHead=l=>HEAD.test(l)&&/[A-ZÀ-Ý]{3}/.test(l)&&!/^(EXAME REALIZADO|NOME|MEDICO|MÉDICO|CONV|POSTO|PROTOCOLO|OBS)/.test(l);
  const strip=s=>s.replace(/(?:acima de|acima|abaixo de|ate|maiores de|menores de)?\s*\d+\s*(?:anos|ano|meses|mes|dias|horas|semanas)\b/g," ");
  const range=raw=>{const s=strip(nrm(raw));let r;
    if(r=s.match(new RegExp(NUM+"\\s*(?:a|ate|e|-)\\s*"+NUM))){const a=n2(r[1]),b=n2(r[2]);if(a!=null&&b!=null&&a<=b)return{min:a,max:b}}
    if(r=s.match(new RegExp("(?:inferior ou igual a|inferior a|menor ou igual a|menor que|menos de|ate|<=?)\\s*"+NUM)))return{min:"",max:n2(r[1])};
    if(r=s.match(new RegExp("(?:superior ou igual a|superior a|igual ou maior que|maior ou igual a|maior que|acima de|>=?)\\s*"+NUM)))return{min:n2(r[1]),max:""};
    return null};
  const sexoOk=s=>sexo==="f"?!/homem|homens|masculino/.test(s):!/mulher|mulheres|feminino|gestante/.test(s);
  const EXCL=/recem|crianca|pediatr|prematur|adolescent|trimestre|a termo|lactente|menos de 24|deficien|insuficien|intoxic|diabet|diagnost|controle|risco|\|/;
  const idOk=raw=>{const m=nrm(raw).match(/acima de (\d+) anos/);return!(m&&+m[1]>=45&&(idade||40)<+m[1])};
  function pickRef(lines,lab){
    const c=lines.filter(l=>l&&sexoOk(nrm(l))&&idOk(l)&&!EXCL.test(nrm(l))&&(!lab||new RegExp("\\b"+lab+"\\b").test(nrm(l))));
    const pref=sexo==="f"?/mulher|mulheres|feminino/:/homem|homens|masculino/;
    for(const l of c.filter(l=>pref.test(nrm(l)))){const r=range(l);if(r)return r}
    for(const l of c.filter(l=>!/homem|homens|mulher|mulheres|masculino|feminino/.test(nrm(l)))){const r=range(l);if(r)return r}
    return {min:"",max:""}}
  let head="",hs=-1;
  for(let i=0;i<L.length;i++){
    const l=L[i];if(/^RESUMO DE RESULTADOS/.test(l))break;
    if(isHead(l)){head=l;hs=i;continue}
    if(head==="HEMOGRAMA"){let d=l.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-\.]{1,30}?)\s*:\s*[\d,\.]+\s*%\s*(\d+)\s*\/mm3\s*(.*)$/);
      if(d){const r=range(d[3]);if(r)out.push({n:d[1].trim()+" (absoluto)",u:"/mm3",v:+d[2],min:r.min,max:r.max});continue}
      let m=l.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ \-\.]{1,30}?)\s*:\s*(\d+(?:[.,]\d+)?)\s*(%)?\s*(\S*)/);
      if(m){let nome=m[1].replace(/\s*-\s*global/i,"").trim(),v=n2(m[2]),un=m[4]||(m[3]||"");const rest=l.slice(m[0].length);
        if(m[3]){const a=rest.match(/^\s*(\d+)\s*\/mm3/);if(a){v=+a[1];un="/mm3";nome+=" (absoluto)"}}
        const r=range(rest)||range(l.slice(m[0].length-0));if(r&&v!=null)out.push({n:nome,u:un.replace(/^%$/,"%"),v,min:r.min,max:r.max});continue}
      m=l.match(/^(Leuc[oó]citos|Plaquetas)[^:]*:\s*(\d+(?:[.,]\d+)?)\s*(\S*)\s*(.*)$/i);
      if(m){const r=range(m[4]);if(r)out.push({n:m[1],u:m[3],v:n2(m[2]),min:r.min,max:r.max});continue}}
    const mr=l.match(/^Resultado[^:]*:\s*(?:([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]{1,25}?)\s*:\s*)?([<>]?)\s*(\d+(?:[.,]\d+)?)\s*(\S*)\s*(.*)$/);
    if(!mr||mr[2])continue;
    const v=n2(mr[3]);if(v==null)continue;
    let nome=head?titulo(head):"Exame";
    for(let k=i-1,seen=0;k>hs&&seen<4;k--){const p=L[k];if(!p)continue;seen++;if(p.includes(":"))continue;
      if(p.length>=3&&p.length<=60&&!/[\d.]/.test(p)&&!/^[-•*|+]/.test(p)&&!SKIPT.test(nrm(p))){nome=p;break}break}
    if(nome===head||nome===titulo(head)){}
    const lab=mr[1]?mr[1].trim():"";if(lab)nome=titulo(head)+" "+lab.toLowerCase();
    const body=[mr[5]];for(let k=i+1;k<L.length&&k<i+40;k++){const p=L[k];if(/^(Nota|Observa|EXAME REALIZADO|Material|Resultado)/.test(p)||isHead(p))break;body.push(p)}
    out.push({n:nome.slice(0,60),u:mr[4].replace(/^microUI/,"µUI"),v,...pickRef(body,lab?nrm(lab):"")});
    if(lab){for(let k=i+1;k<L.length&&k<i+8;k++){const p=L[k].match(/^([A-Za-zÀ-ÿ]+)\s*:\s*(\d+(?:[.,]\d+)?)\s*(\S*)/);if(!p)break;const l2=nrm(p[1]);
      out.push({n:titulo(head)+" "+p[1].toLowerCase(),u:p[3],v:n2(p[2]),...pickRef(body,l2)})}}
  }
  const vistos=new Set();return out.filter(x=>{const k=x.n+"|"+x.v;if(vistos.has(k))return false;vistos.add(k);return true})}
const stEx=x=>{const v=num(x.v),mn=num(x.min),mx=num(x.max);if(v==null)return"?";if(mn!=null&&v<mn)return"baixo";if(mx!=null&&v>mx)return"alto";return mn==null&&mx==null?"?":"ok"};
const refTxt=x=>{const mn=num(x.min),mx=num(x.max);return mn!=null&&mx!=null?fmt(mn,1)+" a "+fmt(mx,1):mx!=null?"até "+fmt(mx,1):mn!=null?"acima de "+fmt(mn,1):"sem faixa"};
const saudeOrd=()=>[...(S.saude||[])].sort((a,b)=>a.data<b.data?1:-1);
const saudeProx=()=>{const u=saudeOrd()[0];if(!u)return null;const p=new Date(u.data+"T12:00:00");p.setFullYear(p.getFullYear()+1);const d=iso(p);return{data:d,dias:diasEntre(today(),d)}};
const saudeAviso=()=>{const p=saudeProx();if(!p)return"";return p.dias<0?"Check-up atrasado há "+(-p.dias)+" dia(s)":p.dias<=30?"Hora de fazer o check-up: faltam "+p.dias+" dia(s)":""};
const dmy=d=>d.slice(8)+"/"+d.slice(5,7)+"/"+d.slice(0,4);
function vAvisos(){
  const a=avisos(),tm=(id,v)=>`<input id="${id}" type="time" value="${v}" style="width:auto">`;
  return page(`<h1 style="margin-bottom:6px">Horários dos avisos</h1><p class="mu" style="font-size:13px;margin:0 0 14px">Escolha os horários que combinam com a sua rotina. Os avisos com o app fechado valem para o fuso do seu celular.</p>
  <div class="lbl" style="margin-top:0">Refeições</div><div class="card flush">${a.ref.map((x,i)=>`<div class="dq"><span class="n">Aviso ${i+1}</span>${tm("av_ref_"+i,x)}<button data-a="avDel" data-i="${i}" aria-label="Remover">✕</button></div>`).join("")||`<div class="dq"><span class="mu">Nenhum horário.</span></div>`}</div>
  <button class="btn ghost" style="margin-top:8px" data-a="avAdd">＋ Adicionar horário</button>
  <div class="lbl">Pesagem</div><div class="card flush"><div class="dq"><span class="n">Avisar às<br><small class="mu">Só se a frequência do peso não for "Livre"</small></span>${tm("av_peso",a.peso)}</div></div>
  <div class="lbl">Check-up</div><div class="card flush"><div class="dq"><span class="n">Avisar às<br><small class="mu">30, 14, 7 e 1 dia antes do prazo de 1 ano</small></span>${tm("av_chk",a.chk)}</div></div>`,{back:"ajustes"});
}
function vSaude(){
  const L=saudeOrd(),u=L[0],pr=saudeProx(),av=saudeAviso();
  const ant=L[1],sum1=c=>{const r={ok:0,fora:0};c.itens.forEach(x=>{const t=stEx(x);if(t==="ok")r.ok++;else if(t!=="?")r.fora++});return r};
  let resumo="";
  if(u){const r=sum1(u),fora=u.itens.filter(x=>["alto","baixo"].includes(stEx(x)));
    resumo=`<h2>Resumo do último check-up</h2><div class="card"><div class="grid3"><div class="mini"><small>Exames</small><b>${u.itens.length}</b></div><div class="mini"><small>Dentro</small><b class="good">${r.ok}</b></div><div class="mini"><small>Fora</small><b class="${r.fora?"bad":"mu"}">${r.fora}</b></div></div>
    ${fora.length?`<div class="lbl">Fora da faixa</div>${fora.map(x=>{const a=ant&&ant.itens.find(y=>y.n===x.n),pv=a?num(a.v):null,seta=pv==null?"":num(x.v)>pv?" ↑":num(x.v)<pv?" ↓":" =";return`<div class="mrow"><span>${esc(x.n)}<br><small class="mu">referência ${refTxt(x)} ${esc(x.u||"")}${pv!=null?" · antes "+fmt(pv,1):""}</small></span><b class="bad">${fmt(num(x.v),1)} ${esc(x.u||"")}${seta}</b></div>`}).join("")}`:`<p class="good" style="margin:12px 0 0;font-weight:600">Todos os exames com faixa estão dentro da referência.</p>`}
    <div class="lbl">Todos os exames</div>${u.itens.map(x=>{const t=stEx(x);return`<div class="mrow"><span>${esc(x.n)}<br><small class="mu">ref. ${refTxt(x)} ${esc(x.u||"")}</small></span><b class="${t==="ok"?"good":t==="?"?"mu":"bad"}">${fmt(num(x.v),1)} ${esc(x.u||"")}${t==="alto"?" ↑":t==="baixo"?" ↓":""}</b></div>`}).join("")}</div>`}
  return page(`<h1 style="margin-bottom:14px">Saúde</h1>
  <div class="card">${av?`<div class="callout" style="margin:0 0 12px"><b class="${pr.dias<0?"bad":"good"}">🩺 ${av}</b></div>`:""}${u?`<div class="mrow"><span class="mu">Último check-up</span><b>${dmy(u.data)}</b></div><div class="mrow"><span class="mu">Próximo (1 ano depois)</span><b>${dmy(pr.data)}</b></div>`:`<p class="mu" style="margin:0">Nenhum check-up registrado. Envie o PDF dos seus exames ou digite os valores.</p>`}
  <label class="btn" style="display:block;text-align:center;cursor:pointer;margin-top:14px">Enviar PDF de exames<input type="file" id="sa_file" accept=".pdf,application/pdf" hidden></label><button class="btn ghost" style="margin-top:8px" data-a="saNew">Digitar manualmente</button>
  <div class="mu" style="font-size:12px;margin-top:10px">O app lê o texto do PDF e tenta reconhecer os exames mais comuns. Confira os valores antes de salvar. O arquivo PDF não fica guardado, só os valores. Isto não substitui a avaliação do seu médico.</div></div>
  ${resumo}
  ${L.length?`<h2>Check-ups</h2><div class="card flush">${L.map(c=>{const r=sum1(c);return`<button class="row" data-a="saEdit" data-id="${c.id}"><span class="n"><b>${dmy(c.data)}${c.lab?" · "+esc(c.lab):""}</b><small>${c.itens.length} exames · ${r.fora?r.fora+" fora da faixa":"dentro da faixa"}</small></span><span class="mu">›</span></button>`}).join("")}</div>`:""}`,{back:"inicio"});
}
function vSaudeEd(){
  const c=sdDraft;if(!c){view="saude";return vSaude()}
  const f=(i,k,l,v,mode)=>`<div class="fld"><label for="sx_${i}_${k}">${l}</label><input id="sx_${i}_${k}" inputmode="${mode}" value="${esc(v??"")}"></div>`;
  return page(`<h1 style="margin-bottom:14px">${c.novo?"Novo check-up":"Editar check-up"}</h1>
  <div class="grid2"><div class="fld"><label for="sx_data">Data do exame</label><input id="sx_data" type="date" value="${c.data}" max="${today()}"></div>${field("sx_lab","Laboratório (opcional)",c.lab||"","",'maxlength="40"')}</div>
  <div class="mu" style="font-size:12px;margin:8px 0 0">Valor e faixa de referência vêm do seu laudo. Se não tiver faixa, deixe em branco.</div>
  ${c.itens.map((x,i)=>{const t=stEx(x);return`<div class="card" style="margin-top:12px"><div class="rh" style="margin:0 0 8px"><b class="${t==="ok"?"good":t==="?"?"mu":"bad"}">${t==="ok"?"Dentro":t==="?"?"Sem faixa":t==="alto"?"Acima":"Abaixo"}</b><button class="lk" data-a="saExDel" data-i="${i}">Remover</button></div>
    <div class="grid2">${f(i,"n","Exame",x.n,"text")}${f(i,"u","Unidade",x.u,"text")}</div>
    <div class="grid3" style="margin-top:10px">${f(i,"v","Valor",x.v,"decimal")}${f(i,"min","Mínimo",x.min,"decimal")}${f(i,"max","Máximo",x.max,"decimal")}</div></div>`}).join("")}
  <button class="btn ghost" style="margin-top:12px" data-a="saExAdd">＋ Adicionar exame</button>
  <button class="btn" style="margin-top:12px" data-a="saSave">Salvar check-up</button>
  ${c.novo?"":`<button class="lk" data-a="saDel" style="display:block;margin:14px auto 0"><span class="bad">Excluir este check-up</span></button>`}`,{back:"saude"});
}
const trTxt=x=>[x.s&&x.r?x.s+" × "+x.r:x.s?x.s+" séries":x.r?x.r+" reps":"",x.c?fmt(x.c,1)+" kg":"",x.i?x.i+" s de intervalo":""].filter(Boolean).join(" · ");
function trLista(t){return t.ex.length?`<div class="card flush">${t.ex.map(x=>`<div class="dq"><span class="n"><b>${esc(x.n)}</b><br><small class="mu">${trTxt(x)||"sem detalhes"}</small></span></div>`).join("")}</div>`:`<p class="mu" style="font-size:13px">Sem exercícios.</p>`}
function vTreinoEd(){
  const t=trDraft;if(!t){view="treino";return vTreino()}
  const f=(i,k,l,ph,v,mode)=>`<div class="fld"><label for="tx_${i}_${k}">${l}</label><input id="tx_${i}_${k}" inputmode="${mode}" value="${esc(v??"")}" placeholder="${ph}"></div>`;
  return page(`<h1 style="margin-bottom:14px">${t.novo?"Novo treino":"Editar treino"}</h1>
  ${field("tx_nome","Nome do treino",t.nome,"Ex.: Treino A · Peito e tríceps",'maxlength="40"')}
  ${t.ex.map((x,i)=>`<div class="card" style="margin-top:12px"><div class="rh" style="margin:0 0 8px"><b>Exercício ${i+1}</b><button class="lk" data-a="trExDel" data-i="${i}">Remover</button></div>
    <div class="fld"><label for="tx_${i}_n">Exercício</label><input id="tx_${i}_n" value="${esc(x.n)}" maxlength="60" placeholder="Ex.: Supino reto"></div>
    <div class="grid2" style="margin-top:10px">${f(i,"s","Séries","4",x.s,"numeric")}${f(i,"r","Repetições","10",x.r,"numeric")}</div>
    <div class="grid2" style="margin-top:10px">${f(i,"c","Carga (kg)","40",x.c,"decimal")}${f(i,"i","Intervalo (seg)","60",x.i,"numeric")}</div></div>`).join("")}
  <button class="btn ghost" style="margin-top:12px" data-a="trExAdd">＋ Adicionar exercício</button>
  <button class="btn" style="margin-top:12px" data-a="trSave">Salvar treino</button>
  ${t.novo?"":`<button class="lk" data-a="trDel" style="display:block;margin:14px auto 0"><span class="bad">Excluir este treino</span></button>`}`,{back:"treino"});
}
function vInicio(){
  cur=today();
  const D=day(cur),tipo=D.tipo||"Descanso",m=metaFor(tipo),t=sum(ents(cur)),g=D.gasto||m.gasto,s=t.k-g,has=t.k>0,fr=Fin.homeSum(S.fin),h=new Date().getHours();
  const pesos=Object.entries(S.days).filter(([,x])=>x.peso).sort((a,b)=>a[0]<b[0]?-1:1),pe=pesos.length?pesos[pesos.length-1][1].peso:null;
  const sg=v=>(v>0?"+":v<0?"−":"")+fmt(Math.abs(v)),row=(k,v,c="")=>`<div class="mrow"><span class="mu">${k}</span><b class="${c}">${v}</b></div>`;
  return page(`<div class="top"><div><div class="mu">${new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</div><h1>${h<12?"Bom dia":h<18?"Boa tarde":"Boa noite"}${S.profile?.nome?", "+esc(S.profile.nome):""}</h1></div><button class="gear" data-a="go" data-v="ajustes" aria-label="Ajustes">⚙</button></div>
  ${ringCard(t,m,D)}
  <button class="mc" data-a="go" data-v="hoje"><div class="mh"><span class="mi">🥗</span><b>Nutrição</b><span class="mu">›</span></div>${row("Calorias hoje",m.k?fmt(t.k)+" de "+fmt(m.k)+" kcal":fmt(t.k)+" kcal")}${m.k?`<div class="bar"><i style="width:${Math.min(100,t.k/m.k*100)}%"></i></div>`:""}${row("Proteína",fmt(t.p)+(m.p?" de "+fmt(m.p):"")+" g")}${row("Peso atual",pe?fmt(pe,1)+" kg":"—")}${pesoDue()?`<div class="due">⚖ ${pesoDue()}</div>`:""}</button>
  <button class="mc" data-a="go" data-v="treino"><div class="mh"><span class="mi">🏋️</span><b>Treino</b><span class="mu">›</span></div>${row("Dia de hoje",tipo==="Treino"?"Treino":"Descanso")}${row("Treino",esc(D.treino||"—"))}${row("Gasto do dia",g?fmt(g)+" kcal":"—")}</button>
  <button class="mc" data-a="go" data-v="fresumo"><div class="mh"><span class="mi">💰</span><b>Finanças</b><span class="mu">›</span></div>${fr?row("Saldo do mês",Fin.brl(fr.saldo),fr.saldo<0?"bad":"good")+row("Viagem",fr.viagem?Fin.brl(fr.viagem.total)+" poupados":"Configurar"):row("Saldo do mês","Configurar")}</button><button class="mc" data-a="go" data-v="saude"><div class="mh"><span class="mi">🩺</span><b>Saúde</b><span class="mu">›</span></div>${(()=>{const u=saudeOrd()[0],pr=saudeProx(),av=saudeAviso();return u?row("Último check-up",dmy(u.data))+row("Próximo",dmy(pr.data),av?(pr.dias<0?"bad":"good"):"")+(av?`<div class="${pr.dias<0?"bad":"good"}" style="font-size:12px;margin-top:6px;font-weight:600">${av}</div>`:""):row("Check-up","Enviar exames")})()}</button><div class="mc soon" aria-disabled="true"><div class="mh" style="margin:0"><span class="mi">📅</span><b>Agenda</b><span class="soonb">Em breve</span></div></div>`,{nonav:true});
}
function render(){
  autoTick();
  const sc=$(".scroll"),y=sc?sc.scrollTop:0;
  let h;
  if(locked&&S.settings.pinHash)h=vLock();
  else h={inicio:vInicio,ajuste:vAjuste,auto:vAuto,treino:vTreino,treinoed:vTreinoEd,alimento:vAlimento,avisos:vAvisos,saude:vSaude,saudeed:vSaudeEd,thist:vHist,hist:vHist,tplano:()=>vCalc(true),fresumo:()=>page(Fin.vResumo()),fcontas:()=>page(Fin.vContas()),fviagem:()=>page(Fin.vViagem()),finimp:()=>page(Fin.vImport(),{back:"ajustes"}),onb:vOnb,hoje:vHoje,lancar:vLancar,peso:vPeso,ajustes:vAjustes,login:vLogin,import:vImport,hist:vHist,plano:vPlano,planoimp:vPlanoImp,calc:vCalc,cad:vCad,conta:vConta,setpin:vSetPin}[view]();
  $("#app").innerHTML=h;
  const n=$(".scroll");if(n&&y&&sc)n.scrollTop=y;
}

/* ---------- Ações ---------- */
function readOb(){const g=id=>{const e=$("#"+id);return e?e.value:null};["nome","idade","alt","peso","email","pw"].forEach(k=>{const v=g("o_"+k);if(v!==null)ob[k]=v})}
async function finishOb(local){
  const p={nome:ob.nome.trim().slice(0,30),idade:num(ob.idade),alt:num(ob.alt),peso:num(ob.peso),sexo:ob.sexo,goal:ob.goal};
  if(pinBuf.length!==4)return toast("Defina um PIN de 4 dígitos");
  if(!local&&Cloud.on()){
    if(!/^\S+@\S+\.\S+$/.test(ob.email))return toast("E-mail inválido");
    if(ob.pw.length<8)return toast("A senha precisa de 8 ou mais caracteres");
    try{if(!(await Cloud.signUp(ob.email,ob.pw)))return toast("Confirme o e-mail que enviamos e depois toque em Criar conta de novo")}
    catch(e){
      if(!/already|registered|exist/i.test(e.message))return toast(e.message);
      try{await Cloud.signIn(ob.email,ob.pw)}catch(e2){return toast(/confirm/i.test(e2.message)?"Confirme o e-mail que enviamos e tente de novo":"E-mail já cadastrado. Use a mesma senha da criação da conta")}
    }
  }
  S.profile=p;S.onboarded=true;if(local)S.localOnly=true;{const D=day(today());if(!D.peso){D.peso=p.peso;queue("days",{date:today(),...D},true)}}await storePin(pinBuf);pinBuf="";locked=false;view="inicio";save();
  S.session?Cloud.queueAll():0;render();
}
function moveMeal(from,to){S.entries.forEach(e=>{if(e.meal===from){e.meal=to;queue("entries",e,true)}})}
const LEGM=["cafe da manha","almoco","refeicao da tarde","jantar"];
function canonMeal(nome){const M=S.settings.meals;if(M.includes(nome))return nome;const n=norm(nome);let i=LEGM.indexOf(n);if(i<0&&/quebra/.test(n))i=0;if(i<0)i=M.length-1;return M[Math.min(i,M.length-1)]}
const clamp=(v,a,b)=>{v=+v;return isNaN(v)?0:Math.max(a,Math.min(b,v))};
async function runImport(url,token,say){
  const get=async p=>{const r=await fetch(url+"?"+new URLSearchParams({token,...p}));let j;try{j=await r.json()}catch(e){throw new Error("resposta inválida do script")}if(!j.ok)throw new Error(j.erro==="token"?"token incorreto":(j.erro||"erro"));return j};
  say("Lendo planilha...");
  const[boot,h]=await Promise.all([get({action:"bootstrap"}),get({action:"hist"})]);
  const pa=(boot.alimentos||[]).filter(f=>f.g==="Plano alimentar"&&f.n),metas=cleanMetas(boot.metas),refs=[];
  for(const f of pa){const m=String(f.n).match(/^\s*(.+?)\s*(?:[-–—:|\/»])\s*(.+)$/),sep=m&&MEALRX.test(norm(m[1])),nome=sep?m[2]:String(f.n),u=/unid|^un/i.test(f.u)?"unid":/ml/i.test(f.u)?"ml":"g";
    const R=refGet(refs,sep?m[1]:"Itens do plano");if(R.itens.length<60)R.itens.push({n:nome.slice(0,80),q:clamp(f.por,.1,10000)||100,u,k:clamp(f.k,0,20000),p:clamp(f.p,0,2000),c:clamp(f.c,0,2000),g:clamp(f.f,0,2000)})}
  const old=S.dieta||{};
  if(metas||refs.length){S.dieta={fonte:"planilha antiga",metas:null,...old,em:nowISO()};if(metas&&!(old.metas&&(old.metas.treino||old.metas.descanso)))S.dieta.metas=metas;
    if(refs.length&&!planRefs("treino").length&&!planRefs("descanso").length)S.dieta.dias={treino:refs.slice(0,10),descanso:structuredClone(refs.slice(0,10))}}
  let fl=(boot.alimentos||[]).filter(f=>f.n).map(f=>({n:String(f.n).slice(0,80),g:String(f.g||"Meus alimentos").slice(0,40),u:/unid|^un/i.test(f.u)?"unid":/ml/i.test(f.u)?"ml":"g",por:clamp(f.por,.1,10000)||100,k:clamp(f.k,0,20000),p:clamp(f.p,0,2000),c:clamp(f.c,0,2000),f:clamp(f.f,0,2000)}));
  if(JSON.stringify(fl).length>120000)fl=fl.filter(f=>f.g==="Meus alimentos"||f.g==="Plano alimentar");
  const names=new Set(fl.map(f=>f.n));S.customFoods=S.customFoods.filter(f=>!names.has(f.n)).concat(fl);
  const dias=h.dias||[];let nd=0,ne=0,i=0;
  for(const d of dias){if(!/^\d{4}-\d{2}-\d{2}$/.test(d.data))continue;const D=S.days[d.data]||(S.days[d.data]={tipo:"",treino:"",peso:null,gasto:null});
    if(!D.tipo&&["Treino","Descanso"].includes(d.tipo))D.tipo=d.tipo;if(!D.treino&&d.treino)D.treino=String(d.treino).slice(0,80);
    if(D.peso==null&&d.peso>20&&d.peso<500)D.peso=+d.peso;if(D.gasto==null&&d.gasto>0&&d.gasto<20000)D.gasto=+d.gasto;
    queue("days",{date:d.data,...D},true);nd++}
  const alvo=dias.filter(d=>d.consumo>0&&!S.imported[d.data]);
  for(const d of alvo){say("Importando lançamentos "+(++i)+" de "+alvo.length+"...");
    const j=await get({action:"dia",data:d.data});
    for(const r of j.refs||[]){if(!r.nome)continue;const e={id:uid(),date:d.data,meal:canonMeal(r.meal||""),name:String(r.nome).slice(0,120),qty:clamp(r.qtd,0,100000),unit:/unid|^un/i.test(r.unid)?"unid":/ml/i.test(r.unid)?"ml":"g",k:clamp(r.k,0,20000),p:clamp(r.p,0,2000),c:clamp(r.c,0,2000),g:clamp(r.g,0,2000),deleted:false};S.entries.push(e);queue("entries",e,true);ne++}
    S.imported[d.data]=1;if(i%10===0)save()}
  queueState();save();Cloud.sync();
  const np=planRefs("treino").reduce((a,r)=>a+r.itens.length,0),nm=S.dieta&&S.dieta.metas?Object.keys(S.dieta.metas).length:0;
  return "Pronto: "+ne+" lançamentos, "+nd+" dias e "+fl.length+" alimentos importados. Plano alimentar: "+nm+" meta(s) e "+np+" item(ns). Volte para Hoje.";
}
/* ---------- Plano alimentar: metas do nutricionista + refeições com quantidades ---------- */
const un=u=>u==="unid"?"un":u;
const UN=(u,d="g")=>{u=norm(u||"");if(!u)return d;if(/^(ml|l|litros?)/.test(u))return"ml";if(/^(g|gr|grs|gramas?|kg)$/.test(u))return"g";return"unid"};
const UNM=u=>/^(kg|l|litros?)$/i.test(u||"")?1000:1;
const MEALRX=/^(\d+ (a |o )?refeicao|refeicao \d+|(primeira|segunda|terceira|quarta|quinta|sexta|setima|oitava) refeicao|cafe da manha|desjejum|lanche( da (manha|tarde|noite))?|almoco|jantar|janta|ceia|pre treino|pos treino|colacao|refeicao( da tarde)?)\b/;
const UNRX="kg|gr?s?|gramas?|ml|l|litros?|unidades?|unid|un|fatias?|colher(?:es)?(?:\\s+de\\s+(?:sopa|ch[aá]|sobremesa))?|x[ií]caras?|copos?|por[cç][aãõo]\\w*|scoops?";
const QRX=new RegExp("^(\\d+(?:[.,]\\d+)?)\\s*(?:("+UNRX+")(?=[\\s.,;:)]|$))?\\s*(?:de\\s+|d[oa]s?\\s+)?(.+)$","i");
const NRX=new RegExp("^(.+?)\\s*[:–—-]?\\s*\\(?(\\d+(?:[.,]\\d+)?)\\s*("+UNRX+")(?=[\\s.,;:)]|$)\\)?\\s*(.*)$","i");
const refGet=(refs,nome)=>{let r=refs.find(x=>norm(x.nome)===norm(nome));if(!r){r={nome:String(nome).trim().slice(0,40)||"Refeição",itens:[]};refs.push(r)}return r};
function findFood(name){const tk=norm(name).split(" ").filter(Boolean);
  for(let n=tk.length;n>0;n--){const t=tk.slice(0,n),m=foods().filter(f=>{f._n=f._n||norm(f.n);const ws=f._n.split(" ");return t.every(x=>ws.some(w=>w.startsWith(x)||(x.length>3&&x.endsWith("s")&&w.startsWith(x.slice(0,-1)))))});if(m.length)return m.sort((a,b)=>a.n.length-b.n.length)[0]}
  return null}
function mkItem(n,mn,q,u,x){
  n=String(n).trim().slice(0,80);const f=findFood(mn||n);let qq=q;
  if(!(qq>0)){if(f){qq=f.por;u=f.u}else qq=0}
  qq=clamp(qq,0,100000);const it={n,q:qq,u,k:0,p:0,c:0,g:0,ok:false};
  if(f&&qq>0&&(f.u===u||(f.u!=="unid"&&u!=="unid"))){const z=qq/f.por;Object.assign(it,{k:+(f.k*z).toFixed(1),p:+(f.p*z).toFixed(1),c:+(f.c*z).toFixed(1),g:+(f.f*z).toFixed(1),ok:true,via:f.n})}
  if(x&&x.k>0){it.k=clamp(x.k,0,20000);it.ok=true;if(x.p!=null)it.p=clamp(x.p,0,2000);if(x.c!=null)it.c=clamp(x.c,0,2000);if(x.g!=null)it.g=clamp(x.g,0,2000)}
  return it}
function cleanMetas(m){const o={};for(const t of["treino","descanso"]){const r=m&&m[t];if(r&&num(r.k)>0)o[t]={k:clamp(r.k,0,20000),p:clamp(r.p,0,2000),c:clamp(r.c,0,2000),g:clamp(r.g,0,2000),gasto:clamp(r.gasto,0,20000)}}return Object.keys(o).length?o:null}
function parseTexto(tx){
  const refs=[];let R=null;
  for(const raw of tx.split(/\r?\n/)){
    let l=raw.replace(/\([^)]*\d{1,2}[:h]\d{2}[^)]*\)|\b\d{1,2}[:h]\d{2}\b|\b\d{1,2}h\b/g," ").replace(/\b(\d+)\/(\d+)\b/g,(m,a,b)=>String(+a/+b)).replace(/^[\s\-•*·–—>]+/,"").replace(/[\s:–—-]+$/,"").replace(/\s+/g," ").trim();
    if(!l||l.length>120)continue;
    const nl=norm(l);
    const rest=nl.replace(MEALRX,"").trim();
    if(MEALRX.test(nl)&&rest.length<=30&&!/\bde\b/.test(rest)&&!/\d+\s*(g|ml|kg|un)\b/.test(rest)){R=refGet(refs,l);continue}
    let k=null;const mk=l.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);if(mk){k=num(mk[1]);l=l.replace(mk[0]," ").replace(/[()]/g," ").replace(/\s+/g," ").trim()}
    let name,q=null,ru="";
    const a=l.match(QRX),b=l.match(NRX);
    if(a&&/^\d/.test(l)){q=num(a[1]);ru=a[2]||"";name=a[3]}
    else if(b){q=num(b[2]);ru=b[3];name=b[1]}
    else{name=l;if(!findFood(name)||name.length>60)continue}
    name=name.replace(/[\s,;:–—-]+$/,"").trim();if(!name)continue;
    const u=UN(ru,"unid");if(q!=null)q*=UNM(ru);
    const med=ru&&u==="unid"&&!/^(un|unid|unidades?)$/i.test(ru)?" ("+ru.toLowerCase()+")":"";
    if(!R)R=refGet(refs,"Refeição 1");
    if(R.itens.length<60)R.itens.push(mkItem(name+med,name,q,u,k?{k}:null))}
  return{metas:null,refs:refs.filter(r=>r.itens.length).slice(0,10)}}
function parseCSV(tx){
  const L=tx.replace(/^﻿/,"").split(/\r?\n/).filter(l=>l.trim()),sep=L[0].includes(";")?";":",";
  const cell=l=>{const r=[];let c="",qt=false;for(const ch of l){if(ch==='"')qt=!qt;else if(ch===sep&&!qt){r.push(c);c=""}else c+=ch}r.push(c);return r.map(s=>s.trim())};
  const rows=L.map(cell),h=rows[0].map(norm),has=h.some(x=>/alimento|^refeicao/.test(x));
  let ix={ref:0,n:1,q:2,u:3,k:4,p:5,c:6,g:7,d:-1};
  if(has){const f=re=>h.findIndex(x=>re.test(x));ix={d:f(/^(dia|tipo)/),ref:f(/^refeicao/),n:f(/^(alimento|item)/),q:f(/^(qtd|quant)/),u:f(/^unid/),k:f(/^(kcal|caloria)/),p:f(/^(p|prot\w*)$/),c:f(/^(c|carb\w*)$/),g:f(/^(g|gord\w*)$/)}}
  const dias={treino:[],descanso:[]},metas={};
  for(const r of rows.slice(has?1:0)){
    const a0=norm(r[0]);
    if(a0==="meta"||a0==="metas"){const t=/trein/.test(norm(r[1]))?"treino":"descanso";metas[t]={k:num(r[2]),p:num(r[3]),c:num(r[4]),g:num(r[5]),gasto:num(r[6])};continue}
    const n=r[ix.n];if(!n)continue;
    const dv=ix.d>=0?norm(r[ix.d]):"",alvo=/trein/.test(dv)?["treino"]:/desc/.test(dv)?["descanso"]:["treino","descanso"];
    for(const t of alvo){const R=refGet(dias[t],(ix.ref>=0&&r[ix.ref])||"Refeição 1");
      if(R.itens.length<60)R.itens.push(mkItem(n,null,num(r[ix.q]),UN(r[ix.u]),{k:num(r[ix.k]),p:num(r[ix.p]),c:num(r[ix.c]),g:num(r[ix.g])}))}}
  dias.treino=dias.treino.slice(0,10);dias.descanso=dias.descanso.slice(0,10);
  return{metas:cleanMetas(metas),dias}}
function parseJSON(tx){const j=JSON.parse(tx),refs=[];
  for(const r of(j.refeicoes||j.refs||[]).slice(0,10)){const R=refGet(refs,String(r.nome||r.refeicao||"Refeição"));
    for(const i of(r.itens||[]).slice(0,60)){const n=i.n||i.nome;if(!n)continue;R.itens.push(mkItem(n,null,num(i.q??i.qtd),UN(i.u||i.unid),{k:num(i.k??i.kcal),p:num(i.p),c:num(i.c),g:num(i.g)}))}}
  return{metas:cleanMetas(j.metas),refs:refs.filter(r=>r.itens.length)}}
function parseDoc(tx,fname){
  tx=tx.replace(/^﻿/,"").trim();
  if(tx[0]==="{")return parseJSON(tx);
  const first=norm(tx.split(/\r?\n/)[0]);
  if(/\.csv$/i.test(fname||"")||/alimento/.test(first)||/^metas? /.test(first))return parseCSV(tx);
  return parseTexto(tx)}
async function pdfText(file){
  const pdfjs=await import("./vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc="./vendor/pdfjs/pdf.worker.min.mjs";
  const doc=await pdfjs.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise,out=[];
  for(let p=1;p<=Math.min(doc.numPages,20);p++){
    const tc=await(await doc.getPage(p)).getTextContent(),rows=new Map();
    tc.items.forEach(it=>{const t=String(it.str||"");if(!t.trim())return;const y=Math.round(it.transform[5]/4);(rows.get(y)||rows.set(y,[]).get(y)).push({x:it.transform[4],t})});
    [...rows.entries()].sort((a,b)=>b[0]-a[0]).forEach(([,r])=>out.push(r.sort((a,b)=>a.x-b.x).map(i=>i.t).join(" ").replace(/\s+/g," ").trim()));
    out.push("");
  }
  await doc.destroy();return out.join("\n");
}
let pimp=null;
function pimpFrom(tx,fonte,fname){
  let r;try{r=parseDoc(tx.slice(0,200000),fname)}catch(e){return toast("Não consegui ler o arquivo")}
  const dias=r.dias||{treino:r.refs,descanso:structuredClone(r.refs)};
  if(!dias.treino.length&&!dias.descanso.length&&!r.metas)return toast("Não encontrei refeições nem metas nesse texto");
  pimp={fonte,metas:r.metas,dias};view="planoimp";render()}
const TIPOS=[["treino","Dia de treino"],["descanso","Dia de descanso"]];
const planRef=i=>{const L=planRefs(tipoDia()),n=norm(S.settings.meals[i]||"");return L.find(r=>norm(r.nome||"")===n)||L[i]};
const planRefs=t=>{const d=S.dieta;return(d&&((d.dias&&d.dias[t])||d.refs))||[]};
const difDias=dias=>JSON.stringify(dias.treino)!==JSON.stringify(dias.descanso);
const refsHtml=(refs,t,acts)=>refs.map((r,ri)=>`<div class="lbl">${esc(r.nome)} · ${fmt(r.itens.reduce((a,i)=>a+i.k,0))} kcal</div><div class="card flush">${r.itens.map((i,ii)=>`<div class="dq"><span class="n">${esc(i.n)}<br><small class="${i.ok===false?"bad":"mu"}">${i.ok===false?fmt(i.q)+" "+un(i.u)+" · sem calorias":itemTxt(i)+(acts&&i.via?" · ≈ "+esc(i.via):"")}</small></span>${i.ok===false?`<button data-a="impFix" data-t="${t}" data-r="${ri}" data-i="${ii}" aria-label="Informar calorias">⚠</button>`:""}<button data-a="${acts?"impRm":"planRm"}" data-t="${t}" data-r="${ri}" data-i="${ii}" aria-label="Remover">✕</button></div>`).join("")}</div>`).join("");
const itemTxt=i=>`${fmt(i.q)} ${un(i.u)} · ${fmt(i.k)} kcal · P ${fmt(i.p,1)} C ${fmt(i.c,1)} G ${fmt(i.g,1)}`;
function vPlano(){
  const d=S.dieta,mt=(d&&d.metas)||{},T=mt.treino||{},R=mt.descanso||{};
  const f=(id,v,l)=>field(id,l,v?String(v):"","",'inputmode="decimal"');
  const dias={treino:planRefs("treino"),descanso:planRefs("descanso")},dif=difDias(dias);
  const refs=dias.treino.length||dias.descanso.length?(dif?TIPOS:[TIPOS[0]]).map(([t,tn])=>`<h2>${dif?tn:"Refeições do plano"}</h2>${refsHtml(dias[t],t,false)}`).join(""):'<p class="mu" style="font-size:13px">Nenhuma refeição do plano ainda. Importe o plano abaixo.</p>';
  return page(`<h1>Plano alimentar</h1><p class="mu" style="margin:4px 0 16px;font-size:13px">${d?`Origem: ${esc(d.fonte||"manual")}. As metas abaixo substituem o cálculo automático.`:"Traga o plano do seu nutricionista: metas do dia e refeições com as quantidades."}</p>
  <div class="lbl" style="margin-top:0">Metas do dia</div><div class="card"><div class="mu" style="font-size:12px;margin-bottom:6px">Dia de treino</div><div class="grid2">${f("pm_tk",T.k,"Kcal")}${f("pm_tp",T.p,"Proteína (g)")}${f("pm_tc",T.c,"Carbo (g)")}${f("pm_tg",T.g,"Gordura (g)")}</div>
  <div class="mu" style="font-size:12px;margin:14px 0 6px">Dia de descanso</div><div class="grid2">${f("pm_rk",R.k,"Kcal")}${f("pm_rp",R.p,"Proteína (g)")}${f("pm_rc",R.c,"Carbo (g)")}${f("pm_rg",R.g,"Gordura (g)")}</div>
  <button class="btn" style="margin-top:14px" data-a="saveMetas">Salvar metas</button></div>
  ${refs}
  <div class="lbl">Importar o plano</div><div class="card"><p class="mu" style="font-size:13px;margin:0 0 12px">Envie o PDF que a nutricionista te entregou. O app lê o texto do PDF, monta as refeições e mostra tudo para você conferir antes de salvar. As calorias vêm da sua tabela de alimentos quando não estiverem no PDF.</p>
  <label class="btn" style="display:block;text-align:center;cursor:pointer">Enviar PDF do plano<input type="file" id="pl_file" accept=".pdf,application/pdf,.csv,.txt,.json,.md,text/*" hidden></label>
  <p class="mu" style="font-size:12px;margin:10px 0 0">PDFs feitos de foto ou escaneados não têm texto para ler. Se o seu plano é impresso ou veio em foto, digite abaixo.</p></div>
  <div class="lbl">Plano impresso ou em foto</div><div class="card"><p class="mu" style="font-size:13px;margin:0 0 10px">Digite uma refeição por vez: o nome da refeição em uma linha e, abaixo, os itens com a quantidade. Você também pode colar o texto copiado de um documento.</p>
  <textarea id="pl_txt" rows="7" placeholder="Café da manhã&#10;2 ovos&#10;50 g de aveia&#10;&#10;Almoço&#10;150 g de arroz branco cozido&#10;120 g de frango grelhado"></textarea>
  <button class="btn" style="margin-top:10px" data-a="planRead">Ler o que digitei</button>
  <details><summary>Outros formatos</summary><p class="mu" style="font-size:12px;margin:8px 0">O botão de envio também aceita arquivos CSV, TXT e JSON.</p><button class="lk" data-a="planModelo" style="padding:4px 0">Baixar modelo CSV</button></details></div>
  ${d?`<button class="lk" data-a="planClear" style="display:block;margin:6px auto"><span class="bad">Remover plano alimentar</span></button>`:""}`,{back:"ajustes"});
}
function vPlanoImp(){
  const p=pimp;if(!p){view="plano";return vPlano()}
  const dif=difDias(p.dias),tl=(dif?TIPOS:[TIPOS[0]]),all=tl.flatMap(([t])=>p.dias[t]),n=all.reduce((a,r)=>a+r.itens.length,0),fx=all.reduce((a,r)=>a+r.itens.filter(i=>!i.ok).length,0),m=p.metas||{};
  const mc=t=>m[t]?`<div class="calc"><span>${t==="treino"?"Dia de treino":"Dia de descanso"}</span><b>${fmt(m[t].k)} kcal · P ${fmt(m[t].p)} C ${fmt(m[t].c)} G ${fmt(m[t].g)}</b></div>`:"";
  return page(`<h1>Conferir plano</h1><p class="mu" style="margin:4px 0 12px;font-size:13px">${n} ${n===1?"item":"itens"} em ${all.length} ${all.length===1?"refeição":"refeições"}${dif?" (treino e descanso)":""}${p.metas?" e metas do dia":""}.${fx?` <b class="bad">${fx} sem calorias</b>: toque em ⚠ para informar.`:""}</p>
  ${p.metas?`<div class="card">${mc("treino")}${mc("descanso")}</div>`:""}
  ${tl.map(([t,tn])=>`${dif?`<h2>${tn}</h2>`:""}${refsHtml(p.dias[t],t,true)}`).join("")}
  <button class="btn" style="margin-top:14px" data-a="planUse">Usar este plano</button><button class="btn ghost" style="margin-top:8px" data-a="planCancel">Cancelar</button>`,{back:"plano"})}
const A={
  localOnly:()=>{S.localOnly=true;save();view="hoje";render()},
  saveMetas:()=>{const g=id=>num($("#"+id).value),old=(S.dieta&&S.dieta.metas)||{};
    const mk=(t,key)=>{const k=g("pm_"+t+"k");return k>0?{k,p:g("pm_"+t+"p")||0,c:g("pm_"+t+"c")||0,g:g("pm_"+t+"g")||0,gasto:(old[key]||{}).gasto||0}:null};
    const m={};const T=mk("t","treino"),R=mk("r","descanso");if(T)m.treino=T;if(R)m.descanso=R;
    const bad=Object.values(m).some(x=>x.k>20000||x.p>2000||x.c>2000||x.g>2000||x.k<300);if(bad)return toast("Confira os valores das metas");
    S.dieta={fonte:"manual",...(S.dieta||{}),em:nowISO(),metas:Object.keys(m).length?m:null};save();queueState();toast("Metas salvas");render()},
  planRead:()=>{const tx=$("#pl_txt").value;if(tx.trim().length<3)return toast("Cole o texto do plano");pimpFrom(tx,"texto colado")},
  planModelo:()=>{const csv="﻿Dia;Refeição;Alimento;Qtd;Unid;Kcal;P;C;G\nTreino;Café da manhã;Ovo cozido;2;unid;;;;\nTreino;Almoço;Arroz branco cozido;200;g;;;;\nDescanso;Almoço;Arroz branco cozido;150;g;;;;\n;Jantar;Peito de frango grelhado;120;g;198;37;0;4\nMeta;Treino;2800;180;320;70;3100\nMeta;Descanso;2400;170;250;65;2675\n";
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="modelo-plano-alimentar.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)},
  planRm:d=>{const D=S.dieta;if(!D.dias)D.dias={treino:D.refs||[],descanso:structuredClone(D.refs||[])};const same=!difDias(D.dias);D.dias[d.t][+d.r].itens.splice(+d.i,1);D.dias[d.t]=D.dias[d.t].filter(x=>x.itens.length);if(same)D.dias.descanso=structuredClone(D.dias.treino);save();queueState();render()},
  planClear:()=>{if(confirm("Remover o plano alimentar? As metas voltam a ser calculadas pelo app.")){S.dieta=null;save();queueState();render()}},
  impRm:d=>{const same=!difDias(pimp.dias),L=pimp.dias[d.t];L[+d.r].itens.splice(+d.i,1);pimp.dias[d.t]=L.filter(x=>x.itens.length);if(same)pimp.dias.descanso=structuredClone(pimp.dias.treino);render()},
  impFix:d=>{const same=!difDias(pimp.dias),it=pimp.dias[d.t][+d.r].itens[+d.i],k=num(prompt("Calorias totais de “"+it.n+"” ("+fmt(it.q)+" "+un(it.u)+")"));if(k==null||k<=0||k>20000)return;
    it.k=k;it.p=num(prompt("Proteína (g) no total",0))||0;it.c=num(prompt("Carboidrato (g) no total",0))||0;it.g=num(prompt("Gordura (g) no total",0))||0;it.ok=true;if(same)pimp.dias.descanso=structuredClone(pimp.dias.treino);render()},
  planCancel:()=>{pimp=null;go("plano")},
  planUse:()=>{const p=pimp;if(!p)return;const cl=L=>L.filter(r=>r.itens.length).map(r=>({nome:r.nome,itens:r.itens.map(({n,q,u,k,p,c,g})=>({n,q,u,k,p,c,g}))})),
      dias={treino:cl(p.dias.treino),descanso:cl(p.dias.descanso)},old=S.dieta||{},tem=dias.treino.length||dias.descanso.length;
    if(!tem&&!p.metas)return toast("Nada para importar");
    S.dieta={fonte:p.fonte,em:nowISO(),metas:p.metas||old.metas||null,dias:tem?dias:{treino:planRefs("treino"),descanso:planRefs("descanso")}};
    const nomes=(S.dieta.dias.treino.length?S.dieta.dias.treino:S.dieta.dias.descanso).map(r=>r.nome).slice(0,8),atual=S.settings.meals;
    if(nomes.length&&nomes.join("|")!==atual.join("|")&&confirm("Usar as refeições do plano ("+nomes.join(", ")+") no app? Lançamentos antigos passam para a refeição da mesma posição.")){
      S.entries.forEach(e=>{const i=atual.indexOf(e.meal),nm=nomes[Math.min(i<0?nomes.length-1:i,nomes.length-1)];if(e.meal!==nm){e.meal=nm;queue("entries",e,true)}});
      S.settings.meals=nomes}
    pimp=null;save();queueState();Cloud.sync();toast("Plano salvo");go("plano")},
  addPlan:d=>{const r=planRef(meal),it=r&&r.itens[+d.i];if(!it)return;draft.push({f:{n:it.n,u:it.u,por:it.q||1,k:it.k,p:it.p,c:it.c,f:it.g},q:it.q||1});render()},
  planAll:()=>{const r=planRef(meal);if(!r)return;r.itens.forEach(it=>draft.push({f:{n:it.n,u:it.u,por:it.q||1,k:it.k,p:it.p,c:it.c,f:it.g},q:it.q||1}));render()},
  saveGasto:()=>{const raw=$("#gw").value.trim(),D=day(cur);
    if(!raw){D.gasto=null}else{const v=num(raw);if(!(v>=500&&v<20000))return toast("Gasto inválido (entre 500 e 20000 kcal)");D.gasto=Math.round(v)}
    queue("days",{date:cur,...D});toast(D.gasto?"Gasto do dia salvo":"Voltou a usar o gasto estimado");render()},
  pick:d=>{if(d.d<=today()){cur=d.d;render()}},
  ajusteOpen:()=>{if(!revPend)revForce=true;go("ajuste")},
  revApply:()=>{const r=revPend,a=S.auto,hj=today();if(!r)return;revEdit={};revForce=false;
    if(r.kind==="plano"){const dm=S.dieta.metas;S.dieta.metasPlano=S.dieta.metasPlano||structuredClone(dm);
      for(const t in r.nv)Object.assign(dm[t],r.nv[t]);
      a.rev={em:hj,peso:r.peso};S.dieta.ajustadoEm=hj;toast("Metas do plano atualizadas")}
    else if(r.kind==="dados"){a.rev={em:hj,peso:pesoTend()}}
    else{a.applied={...r.nv,em:hj,peso:r.peso};toast("Meta atualizada")}
    a.lastRev=hj;save();queueState();view="hoje";render()},
  revKeep:()=>{const r=revPend,a=S.auto;if(!r)return;revEdit={};revForce=false;if(r.kind==="plano"||r.kind==="dados")a.rev={em:today(),peso:pesoTend()};a.lastRev=today();save();queueState();toast(r.kind==="auto"?"Meta mantida":"Plano mantido");view="hoje";render()},
  revGoal:d=>{if(!S.profile)return;revEdit={};S.profile.goal=+d.i;save();queueState();render()},
  revReset:()=>{if(!S.dieta||!S.dieta.metasPlano)return;if(!confirm("Voltar às metas originais do plano?"))return;S.dieta.metas=structuredClone(S.dieta.metasPlano);delete S.dieta.metasPlano;delete S.dieta.ajustadoEm;S.auto.base=null;save();queueState();toast("Metas originais restauradas");render()},
  autoToggle:()=>{const a=S.auto;if(!a.on){if(!calcGasto())return toast("Complete o cadastro primeiro");const{nv}=novaMeta();a.on=true;a.applied={...nv,em:today(),peso:pesoTend()};a.lastRev=today()}else{a.on=false;a.base=null;a.lastRev=today()}save();queueState();render()},
  autoRitmo:d=>{revEdit={};S.auto.ritmo=+d.i;if(S.auto.on&&calcGasto()){const{nv}=novaMeta();S.auto.applied={...nv,em:today(),peso:pesoTend()}}save();queueState();render()},
  autoNow:()=>{if(!calcGasto())return;const{nv}=novaMeta();S.auto.applied={...nv,em:today(),peso:pesoTend()};S.auto.lastRev=today();save();queueState();toast("Meta recalculada");render()},
  verTap:()=>{if(devOn)return;if(++devTaps>=5){devOn=true;toast("Ferramentas avançadas liberadas");render()}},
  mealEdit:()=>{editMeals=!editMeals;render()},
  mealAdd:()=>{const M=S.settings.meals;if(M.length>=10)return toast("Máximo de 10 refeições");let n=M.length+1,nm;do{nm=n+"ª refeição";n++}while(M.includes(nm));M.push(nm);queueState();render()},
  mealDel:d=>{const M=S.settings.meals,i=+d.i;if(M.length<=1)return toast("Mantenha pelo menos uma refeição");
    const nm=M[i],dest=M[i?i-1:1],cnt=S.entries.filter(e=>e.meal===nm&&!e.deleted).length;
    if(cnt&&!confirm("“"+nm+"” tem "+cnt+" lançamento(s). Eles passam para “"+dest+"”. Remover a refeição?"))return;
    moveMeal(nm,dest);M.splice(i,1);if(meal>=M.length)meal=M.length-1;queueState();render()},
  saNew:()=>{sdDraft={novo:true,id:uid(),data:today(),lab:"",itens:[{n:"",u:"",v:"",min:"",max:""}]};go("saudeed")},
  saEdit:d=>{const c=(S.saude||[]).find(x=>x.id===d.id);if(!c)return;sdDraft=structuredClone(c);go("saudeed")},
  saExAdd:()=>{if(sdDraft&&sdDraft.itens.length<80){sdDraft.itens.push({n:"",u:"",v:"",min:"",max:""});render()}},
  saExDel:d=>{if(sdDraft){sdDraft.itens.splice(+d.i,1);render()}},
  saSave:()=>{const c=sdDraft;if(!c)return;if(!/^\d{4}-\d{2}-\d{2}$/.test(c.data||"")||c.data>today())return toast("Data inválida");
    const itens=c.itens.filter(x=>(x.n||"").trim()&&num(x.v)!=null).map(x=>({n:x.n.trim().slice(0,60),u:(x.u||"").trim().slice(0,20),v:num(x.v),min:num(x.min)??"",max:num(x.max)??""}));
    if(!itens.length)return toast("Informe pelo menos um exame com valor");
    if(!S.saude)S.saude=[];const o=S.saude.find(x=>x.id===c.id),row={id:c.id,data:c.data,lab:(c.lab||"").trim().slice(0,40),itens};
    o?Object.assign(o,row):S.saude.push(row);sdDraft=null;save();queueState();toast("Check-up salvo");go("saude")},
  saDel:()=>{const c=sdDraft;if(!c||!confirm("Excluir este check-up?"))return;S.saude=(S.saude||[]).filter(x=>x.id!==c.id);sdDraft=null;save();queueState();toast("Check-up excluído");go("saude")},
  trNew:()=>{trDraft={novo:true,id:uid(),nome:"",ex:[{n:"",s:"",r:"",c:"",i:""}]};go("treinoed")},
  trEdit:d=>{const t=(S.treinos||[]).find(x=>x.id===d.id);if(!t)return;trDraft=structuredClone(t);if(!trDraft.ex.length)trDraft.ex.push({n:"",s:"",r:"",c:"",i:""});go("treinoed")},
  trExAdd:()=>{if(trDraft&&trDraft.ex.length<30){trDraft.ex.push({n:"",s:"",r:"",c:"",i:""});render()}},
  trExDel:d=>{if(trDraft){trDraft.ex.splice(+d.i,1);render()}},
  trSave:()=>{const t=trDraft;if(!t)return;const nome=(t.nome||"").trim().slice(0,40);if(!nome)return toast("Dê um nome ao treino");
    if((S.treinos||[]).some(x=>x.id!==t.id&&x.nome===nome))return toast("Já existe um treino com esse nome");
    const ex=t.ex.filter(x=>(x.n||"").trim()).map(x=>({n:x.n.trim().slice(0,60),s:clamp(x.s,0,99)||"",r:clamp(x.r,0,999)||"",c:clamp(x.c,0,2000)||"",i:clamp(x.i,0,3600)||""}));
    if(!S.treinos)S.treinos=[];const old=S.treinos.find(x=>x.id===t.id);
    if(old){const D=day(cur);if(D.treino===old.nome&&old.nome!==nome){D.treino=nome;queue("days",{date:cur,...D},true)}Object.assign(old,{nome,ex})}else S.treinos.push({id:t.id,nome,ex});
    trDraft=null;save();queueState();toast("Treino salvo");go("treino")},
  trDel:()=>{const t=trDraft;if(!t||!confirm("Excluir este treino?"))return;S.treinos=(S.treinos||[]).filter(x=>x.id!==t.id);trDraft=null;save();queueState();toast("Treino excluído");go("treino")},
  trUse:d=>{const t=(S.treinos||[]).find(x=>x.id===d.id);if(!t)return;const D=day(cur);D.treino=D.treino===t.nome?"":t.nome;queue("days",{date:cur,...D});toast(D.treino?"Treino do dia definido":"Treino removido do dia");render()},
  saveTreino:()=>{const D=day(cur);D.treino=$("#tr_nome").value.trim().slice(0,80);queue("days",{date:cur,...D});toast(D.treino?"Treino salvo":"Treino removido");render()},
  runImport:async()=>{const url=$("#i_url").value.trim(),tok=$("#i_tok").value.trim(),msg=$("#i_msg"),btn=$("#i_go");
    if(!/^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+\/|macros\/)s\/[\w-]+\/exec$/.test(url)||!tok)return toast("Confira o endereço e o token");
    btn.disabled=true;try{msg.textContent=await runImport(url,tok,x=>msg.textContent=x)}catch(e){msg.textContent="Falhou: "+e.message}btn.disabled=false},
  go:d=>go(d.v),
  key:async d=>{
    if(Date.now()<blockedUntil)return;
    if(d.k==="⌫")pinBuf=pinBuf.slice(0,-1);else if(pinBuf.length<4)pinBuf+=d.k;
    if(view==="onb")readOb();
    if(pinBuf.length===4){
      if(locked){const ok=(await hashPin(pinBuf,S.settings.pinSalt))===S.settings.pinHash;pinBuf="";if(ok){fails=0;locked=false;view=needLogin()?"login":"inicio"}else if(++fails>=5){blockedUntil=Date.now()+30000*Math.min(fails-4,10)}render();if(!ok)toast("PIN incorreto");return}
      if(view==="setpin"){await storePin(pinBuf);pinBuf="";view="ajustes";toast("PIN definido");render();return}
    }
    render();
  },
  goal:d=>{readOb();ob.goal=+d.i;render()},sexo:d=>{readOb();ob.sexo=d.s;render()},
  obBack:()=>{readOb();ob.step--;render()},obLocal:()=>{readOb();finishOb(true)},
  obNext:()=>{readOb();
    if(ob.step===1){if(!ob.nome.trim()||!(num(ob.idade)>=10)||!(num(ob.alt)>=100)||!(num(ob.peso)>=30))return toast("Preencha nome, idade, altura e peso")}
    if(ob.step===2)return finishOb(false);
    ob.step++;render()},
  day:d=>{const x=new Date(cur+"T12:00:00");x.setDate(x.getDate()+ +d.n);if(iso(x)>today())return;cur=iso(x);render()},
  tipo:d=>{const D=day(cur);D.tipo=d.t;queue("days",{date:cur,...D});render()},
  meal:(d)=>{meal=+d.i;if(!d.stay)view="lancar";render()},
  add:d=>{const f=foods().find(x=>x.n===d.n),p=parseQ(q);const usaQ=p.q&&search(q)[0]===f,tp=f.ps&&f.ps.length;draft.push({f,q:usaQ?p.q:(tp?1:""),pi:!usaQ&&tp?0:null});q="";render();try{const el=document.querySelector('[data-di="'+(draft.length-1)+'"]');if(el&&!draft[draft.length-1].q)el.focus()}catch(e){}},
  rm:d=>{draft.splice(+d.i,1);render()},
  saveDraft:()=>{const ml=S.settings.meals[meal],sem=draft.find(x=>!(x.q>0));if(sem)return toast("Informe a quantidade de "+sem.f.n);
    draft.forEach(x=>{const f=x.f,q=amt(x),z=q/f.por,pm=x.pi!=null&&f.ps&&f.ps[x.pi],e={id:uid(),date:cur,meal:ml,name:pm?f.n+" ("+(Number.isInteger(+x.q)?x.q:fmt(x.q,1))+" "+pm.n.toLowerCase()+")":f.n,qty:q,unit:f.u,k:+(f.k*z).toFixed(1),p:+(f.p*z).toFixed(1),c:+(f.c*z).toFixed(1),g:+(f.f*z).toFixed(1),deleted:false};S.entries.push(e);S.usage[f.n]=(S.usage[f.n]||0)+1;queue("entries",e)});
    toast(`${ml} salva`);draft=[];view="hoje";save();render()},
  del:d=>{const e=S.entries.find(x=>x.id===d.id);if(e){e.deleted=true;queue("entries",e);render()}},
  hrng:d=>{hrng=+d.i;render()},
  pesoFreq:d=>{if(PDIAS[d.f]||d.f==="livre"){S.settings.pesoFreq=d.f;queueState();render()}},
  delPeso:d=>{if(!confirm("Remover este registro de peso?"))return;const D=day(d.d);D.peso=null;queue("days",{date:d.d,...D});render()},
  savePeso:()=>{const v=num($("#pw").value),d=($("#pd")||{}).value||today();if(!(v>20&&v<500))return toast("Peso inválido");if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>today())return toast("Data inválida");const D=day(d);D.peso=v;queue("days",{date:d,...D});toast("Peso salvo");render()},
  plan:d=>{S.settings.plan[d.k]=+d.v;save();queueState();render()},
  min:d=>{const p=S.settings.plan;p.min=Math.max(10,Math.min(240,p.min+ +d.n));save();queueState();render()},
  sexoC:d=>{S.profile.sexo=d.s;render()},goalC:d=>{S.profile.goal=+d.i;render()},
  saveCad:()=>{const p={...S.profile,nome:$("#c_nome").value.trim().slice(0,30),idade:num($("#c_idade").value),alt:num($("#c_alt").value),peso:num($("#c_peso").value)};
    if(!p.nome||!(p.idade>=10)||!(p.alt>=100)||!(p.peso>=30))return toast("Confira os campos");if(p.peso!==S.profile.peso){const D=day(today());D.peso=p.peso;queue("days",{date:today(),...D},true)}S.profile=p;save();queueState();toast("Cadastro salvo");go("ajustes")},
  tgPin:()=>{if(S.settings.pinHash){if(confirm("Desativar o bloqueio por PIN?")){S.settings.pinHash=S.settings.pinSalt=null;save();render()}}else go("setpin")},
  avAdd:()=>{const a=avisos();if(a.ref.length>=8)return toast("Máximo de 8 horários");S.settings.avisos={...a,ref:[...a.ref,"12:00"]};save();queueState();remind();render()},
  avDel:d=>{const a=avisos();a.ref.splice(+d.i,1);S.settings.avisos=a;save();queueState();remind();render()},
  tgLem:async()=>{const on=!S.settings.lembrete;if(on){if(!("Notification" in window)||(await Notification.requestPermission())!=="granted")return toast("Permita notificações nas configurações do navegador");
      if(pushOk()){try{await pushOn();S.settings.pushOn=true}catch(e){S.settings.pushOn=false;toast("Avisos com o app fechado indisponíveis agora")}}}
    else{S.settings.pushOn=false;await pushOff()}
    S.settings.lembrete=on;save();queueState();remind();render()},
  tgWifi:()=>{S.settings.wifi=!S.settings.wifi;save();queueState();render()},
  login:async()=>{try{const had=S.onboarded;if(await Cloud.signIn($("#a_email").value.trim(),$("#a_pw").value)){toast("Entrando...");if(had)Cloud.queueAll();S.last=null;await Cloud.sync();view=S.onboarded?"inicio":"onb";render()}}catch(e){toast(e.message)}},
  firstTime:()=>{ob.step=0;view="onb";render()},toLogin:()=>{view="login";render()},
  signup:async()=>{try{toast(await Cloud.signUp($("#a_email").value.trim(),$("#a_pw").value)?"Conta criada":"Confirme o e-mail que enviamos");if(S.session){Cloud.queueAll();view="inicio"}render()}catch(e){toast(e.message)}},
  logout:()=>{S.session=null;S.last=null;save();setStat(false,"Neste aparelho");render()},
  syncNow:async()=>{toast("Sincronizando...");await Cloud.sync();toast(stat.t)},
  exportCsv:()=>{const r=[["data","refeicao","alimento","qtd","unid","kcal","p","c","g"],...S.entries.filter(e=>!e.deleted).sort((a,b)=>a.date<b.date?-1:1).map(e=>[e.date,e.meal,e.name,e.qty,e.unit,e.k,e.p,e.c,e.g])];
    const csv=r.map(l=>l.map(v=>{v=String(v);if(/^[=+\-@\t\r]/.test(v))v="'"+v;return /[";\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v}).join(";")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv"}));a.download="lancamentos.csv";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)},
  wipe:()=>{if(confirm("Apagar todos os dados DESTE aparelho? Dados já sincronizados continuam na sua conta.")){localStorage.removeItem(KEY);location.reload()}},
  newFood:()=>{nf={n:parseQ(q||"").name.slice(0,60)};view="alimento";render();try{const el=document.getElementById(nf.n?"nf_k":"nf_n");el&&el.focus()}catch(e){}},
  nfEdit:d=>{const f=S.customFoods.find(x=>x.n===d.n);if(!f)return;const z=100/(f.por||100),r=v=>+(v*z).toFixed(2);nf={edit:f.n,n:f.n,k:r(f.k),p:r(f.p),c:r(f.c),f:r(f.f),u:f.u==="ml"?"ml":"g"};for(const k of["a","d","f","s","t","n"])if(f.ex&&f.ex[k]!=null)nf["x"+k]=r(f.ex[k]);view="alimento";(f.ps||[]).slice(0,3).forEach((m,i)=>{nf["pn"+i]=m.n;nf["pq"+i]=m.q});render()},
  nfDel:()=>{if(!nf||!nf.edit||!confirm("Excluir este alimento? Os lançamentos já feitos continuam."))return;S.customFoods=S.customFoods.filter(x=>x.n!==nf.edit);nf=null;view="lancar";save();queueState();render();toast("Alimento excluído")},
  nfUn:d=>{if(nf){nf.u=d.u==="ml"?"ml":"g";render()}},
  nfCancel:()=>{nf=null;view="lancar";render()},
  nfSave:()=>{if(!nf)return;const n=(nf.n||"").trim().slice(0,60),k=num(nf.k),p=num(nf.p)||0,c=num(nf.c)||0,f=num(nf.f)||0;
    if(!n)return toast("Digite o nome do alimento");
    if(k==null||k<0||k>1000)return toast("Informe as calorias em 100 g (0 a 1000)");
    if([p,c,f].some(v=>v<0||v>100))return toast("Macros devem ficar entre 0 e 100 g");
    if(foods().some(x=>x.n.toLowerCase()===n.toLowerCase()&&x.n!==nf.edit))return toast("Já existe um alimento com esse nome");
    const ps=[0,1,2].map(i=>({n:(nf["pn"+i]||"").trim().slice(0,20),q:num(nf["pq"+i])})).filter(x=>x.n&&x.q>0&&x.q<=10000),nv={n,g:nf.u==="ml"?"Bebidas":"Meus alimentos",u:nf.u==="ml"?"ml":"g",por:100,k,p,c,f};if(ps.length)nv.ps=ps;const ex={};for(const k of["a","d","f","s","t","n"]){const v=num(nf["x"+k]);if(v!=null&&v>=0&&v<=(k==="n"?10000:100))ex[k]=v}if(Object.keys(ex).length)nv.ex=ex;const ix=nf.edit?S.customFoods.findIndex(x=>x.n===nf.edit):-1;if(ix>=0){if(nf.edit!==n&&S.usage[nf.edit]){S.usage[n]=S.usage[nf.edit];delete S.usage[nf.edit]}S.customFoods[ix]=nv}else S.customFoods.push(nv);const ed=ix>=0;nf=null;view="lancar";q=n;save();queueState();render();toast(ed?"Alimento atualizado":"Alimento cadastrado")}
};
Object.assign(A,Fin.actions({S,save,queueState,render,toast,uid,go}));
document.addEventListener("click",e=>{const el=e.target.closest("[data-a]");if(el&&A[el.dataset.a])A[el.dataset.a](el.dataset)});
document.addEventListener("input",e=>{if(e.target.id==="q"){q=e.target.value;$("#res").innerHTML=foodList()}
  else if(sdDraft&&/^sx_/.test(e.target.id||"")){const id=e.target.id;if(id==="sx_data")sdDraft.data=e.target.value;else if(id==="sx_lab")sdDraft.lab=e.target.value;else{const[,i,k]=id.split("_");if(sdDraft.itens[+i])sdDraft.itens[+i][k]=e.target.value}}
  else if(trDraft&&/^tx_/.test(e.target.id||"")){const id=e.target.id;if(id==="tx_nome")trDraft.nome=e.target.value;else{const[,i,k]=id.split("_");if(trDraft.ex[+i])trDraft.ex[+i][k]=e.target.value}}
  else if(nf&&/^nf_([nkpcf]|p[nq]\d|x[adfstn])$/.test(e.target.id||""))nf[e.target.id.slice(3)]=e.target.value;
  else if(e.target.dataset&&e.target.dataset.di!==undefined){const v=num(e.target.value);draft[+e.target.dataset.di].q=(v>0&&v<=100000)?v:"";const sp=document.querySelector(".sticky .in span");if(sp){const tt=draft.reduce((a,x)=>a+x.f.k*amt(x)/x.f.por,0);sp.textContent=draft.length+" "+(draft.length>1?"itens":"item")+" · "+fmt(tt)+" kcal"}}});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="rv_ini"){const d=t.value;if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||d>today())return;S.auto.rev={em:addDias(d,-1),peso:pesoMedia(addDias(d,-7),d)||pesoTend()};save();queueState();toast("Início do acompanhamento definido");render();return}
  if(/^av_(ref_\d+|peso|chk)$/.test(t.id||"")){const v=t.value;if(!HHMM.test(v))return render();const a=avisos();if(t.id==="av_peso")a.peso=v;else if(t.id==="av_chk")a.chk=v;else a.ref[+t.id.slice(7)]=v;a.ref=[...new Set(a.ref)].sort();S.settings.avisos=a;save();queueState();remind();render();return}
  if(/^rv_(treino|descanso)_[pcg]$/.test(t.id||"")){const[,tp,m]=t.id.split("_"),v=num(t.value);if(v!=null&&v>=0&&v<=2000){revEdit[tp+m]=v;revRefresh()}return}
  if(t.dataset.mi!==undefined){const M=S.settings.meals,i=+t.dataset.mi,nv=t.value.trim().slice(0,30),old=M[i];
    if(!nv)return render();if(M.some((x,j)=>j!==i&&x===nv)){toast("Já existe uma refeição com esse nome");return render()}
    if(nv!==old){moveMeal(old,nv);M[i]=nv;queueState()}render();return}
  if(t.dataset.dp!==undefined){const x=draft[+t.dataset.dp];if(x){x.pi=t.value===""?null:+t.value;if(x.pi!=null&&!(x.q>0))x.q=1;render()}return}
  if(t.dataset.di!==undefined)return;
  if(t.id==="sa_file"&&t.files[0]){const f=t.files[0];t.value="";if(f.size>15e6)return toast("Arquivo grande demais");toast("Lendo o PDF...");
    pdfText(f).then(tx=>{if(tx.replace(/\s/g,"").length<20)return toast("Esse PDF não tem texto para ler (foto ou escaneado). Digite os valores.");
      let itens=[];try{itens=parseLaudo(tx,S.profile&&S.profile.sexo,S.profile&&S.profile.idade)}catch(e){}if(itens.length<3)itens=parseExames(tx);const dm=tx.match(/(?:coleta|data|realizad[oa]|emiss[aã]o)[^\d\n]{0,25}(\d{2})\/(\d{2})\/(\d{4})/i)||tx.match(/(\d{2})\/(\d{2})\/(\d{4})/),dt=dm?dm[3]+"-"+dm[2]+"-"+dm[1]:today();
      sdDraft={novo:true,id:uid(),data:dt>today()?today():dt,lab:"",itens:itens.length?itens:[{n:"",u:"",v:"",min:"",max:""}]};go("saudeed");
      toast(itens.length?"Reconheci "+itens.length+" exame(s). Confira os valores.":"Não reconheci exames. Digite os valores.")}).catch(()=>toast("Não consegui ler o PDF"));return}
  if(t.id==="pl_file"&&t.files[0]){const f=t.files[0],pdf=/\.pdf$/i.test(f.name)||f.type==="application/pdf";if(f.size>(pdf?15e6:2e6)){t.value="";return toast("Arquivo grande demais")}
    if(pdf){toast("Lendo o PDF...");pdfText(f).then(tx=>{if(tx.replace(/\s/g,"").length<20)return toast("Esse PDF não tem texto para ler (foto ou escaneado). Digite o plano na caixa abaixo.");pimpFrom(tx,"PDF: "+f.name.slice(0,40),f.name)}).catch(()=>toast("Não consegui abrir esse PDF"))}
    else f.text().then(tx=>pimpFrom(tx,"documento: "+f.name.slice(0,40),f.name));t.value=""}
  if(t.id==="csv"&&t.files[0]){const f=t.files[0];if(f.size>2e6)return toast("Arquivo grande demais");f.text().then(tx=>{
    const sep=tx.split("\n")[0].includes(";")?";":",",L=tx.replace(/^\ufeff/,"").split(/\r?\n/).slice(1);let n=0;
    L.forEach(l=>{const c=l.split(sep).map(s=>s.replace(/^"|"$/g,"").trim());if(!c[0])return;const u=/unid/i.test(c[2])?"unid":/ml/i.test(c[2])?"ml":"g";const o={n:c[0].slice(0,80),g:(c[1]||"Meus alimentos").slice(0,40),u,por:num(c[3])||100,k:num(c[4])||0,p:num(c[5])||0,c:num(c[6])||0,f:num(c[7])||0};if(o.k<=0||o.k>20000)return;S.customFoods=S.customFoods.filter(x=>x.n!==o.n);S.customFoods.push(o);n++});
    save();queueState();toast(n+" alimentos importados");render()})}
});
let hiddenAt=0;
document.addEventListener("visibilitychange",()=>{if(document.hidden)hiddenAt=Date.now();else{if(S.settings.pinHash&&hiddenAt&&Date.now()-hiddenAt>60000){locked=true;pinBuf="";render()}Cloud.sync();remind()}});
window.addEventListener("online",()=>Cloud.sync());

/* ---------- Lembretes (só disparam com o app aberto; push em segundo plano exige servidor) ---------- */
let rt;
const b64u=b=>{const p="=".repeat((4-b.length%4)%4),r=atob((b+p).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(r,c=>c.charCodeAt(0))};
const pushOk=()=>!!(CFG.vapidPublicKey&&Cloud.on()&&S.session&&"PushManager" in window&&"serviceWorker" in navigator);
async function pushOn(){
  const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64u(CFG.vapidPublicKey)});
  const j=sub.toJSON();
  await Cloud.rest("POST","push_subs?on_conflict=endpoint",{endpoint:j.endpoint,p256dh:j.keys.p256dh,auth:j.keys.auth,tz:Intl.DateTimeFormat().resolvedOptions().timeZone||"America/Sao_Paulo"},{Prefer:"resolution=merge-duplicates,return=minimal"})}
async function pushOff(){
  try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(sub){await Cloud.rest("DELETE","push_subs?endpoint=eq."+encodeURIComponent(sub.endpoint)).catch(()=>{});await sub.unsubscribe()}}catch(e){}}
const AV0={ref:["12:30","19:00"],peso:"08:00",chk:"09:00"},HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
const avisos=()=>{const a={...AV0,...(S.settings.avisos||{})};a.ref=(a.ref||[]).filter(x=>HHMM.test(x));return a};
function remind(){clearTimeout(rt);if(S.settings.pushOn||!S.settings.lembrete||!("Notification" in window)||Notification.permission!=="granted")return;
  const n=new Date(),next=(avisos().ref.length?avisos().ref:[]).map(x=>x.split(":").map(Number)).map(([h,m])=>{const d=new Date();d.setHours(h,m,0,0);if(d<=n)d.setDate(d.getDate()+1);return d}).sort((a,b)=>a-b)[0];if(!next)return;
  rt=setTimeout(async()=>{const r=await navigator.serviceWorker.ready;r.showNotification("Hora de lançar sua refeição",{body:"Registre o que comeu em segundos.",icon:"icon-180.png",tag:"lembrete"});remind()},next-n)}

/* ---------- Início ---------- */
(async()=>{
  if("serviceWorker" in navigator){const had=!!navigator.serviceWorker.controller;navigator.serviceWorker.register("sw.js").then(r=>{r.update();document.addEventListener("visibilitychange",()=>{if(!document.hidden)r.update()})}).catch(()=>{});navigator.serviceWorker.addEventListener("controllerchange",()=>{if(had&&!window.__rl){window.__rl=1;location.reload()}})}
  try{BASE=await (await fetch("foods.json")).json()}catch(e){toast("Não foi possível carregar a lista de alimentos")}
  setStat(false,Cloud.on()?(S.session?"Conectando...":"Entre na conta"):"Neste aparelho");
  render();remind();Cloud.sync();
})();
})();
