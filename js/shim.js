/* Mortelbook web — remplace le « window.claude » de la version Claude :
   - sample : appelle Gemini (gratuit) ou OpenRouter selon l'usage (réseau social, histoires, épicé)
   - db / user : Supabase (connexion + sauvegarde en ligne)
   - downloads : téléchargement d'un fichier
   Aucune dépendance externe : tout passe par fetch. */
(function(){
'use strict';
const CFG=window.MB_CONFIG||{};
const SB_URL=String(CFG.supabaseUrl||'').replace(/\/+$/,'');
const SB_KEY=CFG.supabaseAnonKey||'';
const LS_SESSION='mb-session',LS_AI='mb-ai';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------------- réglages IA ---------------- */
const ROUTES=[
  {k:'social',label:'💬 Réseau social',hint:'Fil, commentaires, messages privés, groupes, événements'},
  {k:'story',label:'📖 Histoires',hint:'Histoires sans l’option Plume soignée'},
  {k:'storyFine',label:'✨ Histoires « Plume soignée »',hint:'Quand la case Plume soignée est cochée'},
  {k:'spicy',label:'🌶️ Épicé',hint:'Messages privés 🌶️, rendez-vous et histoires épicées'},
  {k:'fallback',label:'🛟 Secours',hint:'Utilisé si Gemini refuse ou atteint sa limite (pas pour l’épicé)'}
];
const DEFAULT_AI={
  keys:{gemini:'',openrouter:''},
  routes:{
    social:{p:'gemini',m:'gemini-flash-lite-latest'},
    story:{p:'gemini',m:'gemini-flash-latest'},
    storyFine:{p:'gemini',m:'gemini-flash-latest'},
    spicy:{p:'gemini',m:'gemini-flash-latest'},
    fallback:{p:'openrouter',m:'thedrummer/cydonia-24b-v4.1'}
  }
};
function loadAI(){
  let a=null;try{a=JSON.parse(localStorage.getItem(LS_AI)||'null')}catch(e){}
  a=a||{};
  return {keys:Object.assign({},DEFAULT_AI.keys,a.keys||{}),routes:Object.assign({},JSON.parse(JSON.stringify(DEFAULT_AI.routes)),a.routes||{}),at:a.at||0};
}
let AI=loadAI();
function storeAI(remote){
  AI.at=Date.now();
  try{localStorage.setItem(LS_AI,JSON.stringify(AI))}catch(e){}
  if(remote!==false&&session)kvSet('settings','ai',AI).catch(()=>{});
}

/* ---------------- Supabase : connexion ---------------- */
let session=null;try{session=JSON.parse(localStorage.getItem(LS_SESSION)||'null')}catch(e){}
let authResolve;const authReady=new Promise(r=>authResolve=r);
function saveSession(s){session=s;try{if(s)localStorage.setItem(LS_SESSION,JSON.stringify(s));else localStorage.removeItem(LS_SESSION)}catch(e){}}
async function authCall(path,body){
  const res=await fetch(`${SB_URL}/auth/v1/${path}`,{method:'POST',headers:{apikey:SB_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await res.json().catch(()=>({}));
  if(!res.ok)throw {code:'auth',message:j.error_description||j.msg||j.message||('Erreur '+res.status)};
  return j;
}
function fromToken(j){return{access_token:j.access_token,refresh_token:j.refresh_token,expires_at:Date.now()+(j.expires_in||3600)*1000,user:{id:j.user&&j.user.id,email:j.user&&j.user.email}}}
let refreshing=null;
async function token(){
  if(!session)throw {code:'unavailable',message:'Non connectée'};
  if(Date.now()>session.expires_at-60e3){
    refreshing=refreshing||authCall('token?grant_type=refresh_token',{refresh_token:session.refresh_token}).then(j=>{saveSession(fromToken(j))}).catch(e=>{if(e&&e.code==='auth'){saveSession(null);showLogin('Ta session a expiré, reconnecte-toi.')}throw {code:'unavailable'}}).finally(()=>{refreshing=null});
    await refreshing;
  }
  return session.access_token;
}

/* ---------------- Supabase : table kv ---------------- */
async function rest(method,query,body,extra){
  let res;
  try{
    res=await fetch(`${SB_URL}/rest/v1/kv${query}`,{method,headers:Object.assign({apikey:SB_KEY,Authorization:'Bearer '+await token(),'Content-Type':'application/json'},extra||{}),body:body?JSON.stringify(body):undefined});
  }catch(e){if(e&&e.code)throw e;throw {code:'unavailable',message:String(e&&e.message||e)}}
  if(res.status===401){saveSession(null);showLogin('Ta session a expiré, reconnecte-toi.');throw {code:'unavailable'}}
  if(!res.ok){const t=await res.text().catch(()=>'');throw {code:res.status>=500?'unavailable':'erreur_'+res.status,message:t.slice(0,200)}}
  if(res.status===204)return null;
  const t=await res.text();return t?JSON.parse(t):null;
}
const q=v=>encodeURIComponent(v);
async function kvGet(coll,id){const r=await rest('GET',`?select=data&coll=eq.${q(coll)}&id=eq.${q(id)}`);return r&&r.length?r[0].data:undefined}
async function kvSet(coll,id,data){await rest('POST','?on_conflict=user_id,coll,id',[{user_id:session.user.id,coll,id,data,updated_at:new Date().toISOString()}],{Prefer:'resolution=merge-duplicates,return=minimal'})}
async function kvSetMany(rows){for(let i=0;i<rows.length;i+=25){await rest('POST','?on_conflict=user_id,coll,id',rows.slice(i,i+25).map(r=>Object.assign({user_id:session.user.id,updated_at:new Date().toISOString()},r)),{Prefer:'resolution=merge-duplicates,return=minimal'})}}
async function kvDel(coll,id){await rest('DELETE',`?coll=eq.${q(coll)}&id=eq.${q(id)}`,null,{Prefer:'return=minimal'})}
async function kvIds(coll){let out=[],from=0;for(;;){const r=await rest('GET',`?select=id&coll=eq.${q(coll)}&order=id`,null,{Range:`${from}-${from+999}`,'Range-Unit':'items'});out=out.concat(r||[]);if(!r||r.length<1000)break;from+=1000}return out.map(x=>x.id)}

const dbApi=Object.freeze({
  collection:(path)=>({
    doc:(id)=>({
      get:async()=>{const d=await kvGet(path,id);return{exists:d!==undefined,data:()=>d}},
      set:async(o)=>kvSet(path,id,o),
      delete:async()=>kvDel(path,id)
    }),
    get:async()=>{const ids=await kvIds(path);return{docs:ids.map(id=>({id,exists:true,data:()=>undefined}))}}
  })
});
const userApi=Object.freeze({id:async()=>session&&session.user.id,isOwner:()=>true,canEdit:()=>true,me:async()=>({id:session&&session.user.id})});

/* ---------------- IA : appels ---------------- */
async function* sse(res){
  const rd=res.body.getReader();const dec=new TextDecoder();let buf='';
  for(;;){const {done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});
    let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).replace(/\r$/,'');buf=buf.slice(i+1);if(line.startsWith('data:'))yield line.slice(5).trim()}}
  buf+=dec.decode();if(buf.startsWith('data:'))yield buf.slice(5).trim();
}
function httpErr(status,txt){
  const t=String(txt||'').slice(0,300);
  if(status===401||status===403)return{code:'bad_key',message:t};
  if(status===402)return{code:'credits',message:t};
  if(status===429)return{code:'rate_limited',message:t};
  if(status>=500)return{code:'server',message:t};
  if(/SAFETY|PROHIBITED|blocked/i.test(t))return{code:'blocked',message:t};
  return{code:'erreur_'+status,message:t};
}
async function callGemini(model,prompt,o){
  const key=AI.keys.gemini;if(!key)throw{code:'no_key',message:'Clé Gemini manquante'};
  model=String(model||'').replace(/^models\//,'');
  const cats=['HARM_CATEGORY_HARASSMENT','HARM_CATEGORY_HATE_SPEECH','HARM_CATEGORY_SEXUALLY_EXPLICIT','HARM_CATEGORY_DANGEROUS_CONTENT'];
  let res;
  try{res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,{method:'POST',signal:o.signal,headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:1,maxOutputTokens:o.maxTokens||16384},safetySettings:cats.map(category=>({category,threshold:'BLOCK_NONE'}))})})}
  catch(e){if(e&&e.name==='AbortError')throw{code:'cancelled'};throw{code:'unavailable',message:String(e)}}
  if(!res.ok)throw httpErr(res.status,await res.text().catch(()=>''));
  let text='',reason='';
  try{
    for await(const d of sse(res)){
      let j;try{j=JSON.parse(d)}catch(e){continue}
      if(j.error)throw httpErr(j.error.code||500,j.error.message);
      if(j.promptFeedback&&j.promptFeedback.blockReason)reason=j.promptFeedback.blockReason;
      const c=(j.candidates||[])[0];if(!c)continue;
      if(c.finishReason)reason=c.finishReason;
      const add=((c.content&&c.content.parts)||[]).filter(p=>!p.thought&&p.text).map(p=>p.text).join('');
      if(add){text+=add;o.onText&&o.onText({text,delta:add})}
    }
  }catch(e){if(e&&e.name==='AbortError')throw{code:'cancelled',text};throw e.code?e:{code:'unavailable',message:String(e)}}
  if(!text.trim()&&/SAFETY|PROHIBITED|BLOCK|RECITATION|OTHER/i.test(reason))throw{code:'blocked',message:reason};
  if(!text.trim())throw{code:'empty',message:reason||'réponse vide'};
  return{text,truncated:reason==='MAX_TOKENS'};
}
async function callOpenRouter(model,prompt,o){
  const key=AI.keys.openrouter;if(!key)throw{code:'no_key',message:'Clé OpenRouter manquante'};
  let res;
  try{res=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:o.signal,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','HTTP-Referer':location.origin,'X-Title':'Mortelbook'},
    body:JSON.stringify({model,messages:[{role:'user',content:prompt}],stream:true,max_tokens:o.maxTokens||8000,temperature:0.9})})}
  catch(e){if(e&&e.name==='AbortError')throw{code:'cancelled'};throw{code:'unavailable',message:String(e)}}
  if(!res.ok)throw httpErr(res.status,await res.text().catch(()=>''));
  let text='',reason='';
  try{
    for await(const d of sse(res)){
      if(d==='[DONE]')break;
      let j;try{j=JSON.parse(d)}catch(e){continue}
      if(j.error)throw httpErr(j.error.code||500,j.error.message);
      const c=(j.choices||[])[0];if(!c)continue;
      if(c.finish_reason)reason=c.finish_reason;
      const add=(c.delta&&c.delta.content)||'';
      if(add){text+=add;o.onText&&o.onText({text,delta:add})}
    }
  }catch(e){if(e&&e.name==='AbortError')throw{code:'cancelled',text};throw e.code?e:{code:'unavailable',message:String(e)}}
  if(!text.trim())throw{code:'empty',message:reason||'réponse vide'};
  return{text,truncated:reason==='length'};
}
function callOnce(r,prompt,o){
  if(!r||!r.m||r.p==='none')throw{code:'no_model'};
  return r.p==='openrouter'?callOpenRouter(r.m,prompt,o):callGemini(r.m,prompt,o);
}
/* Surcharge (503) ou limite passagère (429) : on réessaie 2 fois avant d'abandonner ce modèle. */
async function callOneModel(r,prompt,o){
  const waits=[1500,4000];
  for(let i=0;;i++){
    try{return await callOnce(r,prompt,o)}
    catch(e){
      if(i>=waits.length||!['server','rate_limited'].includes(e&&e.code)||/per day|PerDay|quota/i.test(e&&e.message||''))throw e;
      if(o.onText)o.onText({text:'',delta:''});
      await new Promise(res=>setTimeout(res,waits[i]));
      if(o.signal&&o.signal.aborted)throw{code:'cancelled'};
    }
  }
}
/* Plusieurs modèles possibles, séparés par des virgules : on essaie le suivant si le premier est saturé. */
async function callRoute(r,prompt,o){
  const ms=String(r&&r.m||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!ms.length)return callOnce(r,prompt,o);
  let last;
  for(let i=0;i<ms.length;i++){
    try{return await callOneModel(Object.assign({},r,{m:ms[i]}),prompt,o)}
    catch(e){last=e;if(e.code==='cancelled'||e.code==='no_key'||e.code==='bad_key'||e.code==='credits')throw e;if(o.onText)o.onText({text:'',delta:''})}
  }
  throw last;
}
const lastModel={};
async function sample(input,opts){
  const o=Object.assign({},opts||{});
  const prompt=Array.isArray(input)?input.map(t=>t.content).join('\n\n'):String(input);
  const route=AI.routes[o.route]?o.route:'social';
  const chain=[AI.routes[route]];
  if(route!=='spicy'&&AI.routes.fallback&&AI.routes.fallback.p!=='none'&&AI.routes.fallback.m)chain.push(AI.routes.fallback);
  let last=null;const diag=[];
  for(let i=0;i<chain.length;i++){
    try{const r=await callRoute(chain[i],prompt,o);lastModel[route]=chain[i].m;return r}
    catch(e){last=e;if(e.code==='cancelled')throw e;
      diag.push(`${chain[i].p==='openrouter'?'OpenRouter':'Gemini'} (${chain[i].m}) : ${e.code}${e.message?' – '+String(e.message).replace(/\s+/g,' ').slice(0,120):''}`);
      try{console.warn('[Mortelbook IA]',diag[diag.length-1])}catch(x){}
      const retry=['rate_limited','blocked','server','unavailable','empty','no_key'].includes(e.code);
      if(!retry||i===chain.length-1)break;
      if(o.onText)o.onText({text:'',delta:''});
    }
  }
  const m={no_key:'clé API manquante : ouvre ⚙️ pour la renseigner',bad_key:'clé API refusée : vérifie-la dans ⚙️',credits:'crédit OpenRouter épuisé',rate_limited:'modèle saturé ou limite atteinte, réessaie dans une minute',blocked:'le modèle a refusé de répondre',no_model:'aucun modèle choisi pour cet usage dans ⚙️'};
  throw Object.assign({},last,{message:m[last&&last.code]||(last&&last.message)||'erreur',diag:diag.join(' | ')});
}

/* ---------------- téléchargement ---------------- */
const downloadsApi=Object.freeze({save:async({filename,data})=>{
  const blob=data instanceof Blob?data:new Blob([data],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename||'mortelbook.json';document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);return{status:'saved'};
}});

/* ---------------- window.claude ---------------- */
window.claude=Object.freeze({use:async(name)=>{
  if(name==='sample')return sample;
  if(name==='downloads')return downloadsApi;
  if(name==='db'||name==='user'){await authReady;return name==='db'?dbApi:userApi}
  return null;
}});

/* ---------------- interface : connexion ---------------- */
const CSS=`.mbov{position:fixed;inset:0;z-index:80;background:var(--bg,#e9eee6);overflow:auto;padding:max(24px,env(safe-area-inset-top)) 16px 40px;color:var(--ink,#17322a)}
.mbov .box{max-width:460px;margin:0 auto}
.mbov h2{font-family:"IM Fell English",serif;font-weight:400;font-size:30px;margin:6px 0 4px}
.mbov label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
.mbov input,.mbov select{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:12px;border:1px solid var(--line,#cbd6c7);background:var(--surface,#fff);color:inherit;font:inherit}
.mbov .row{display:flex;gap:8px;align-items:center}.mbov .row>*{flex:1}
.mbov .sec{border:1px solid var(--line,#cbd6c7);background:var(--surface,#fff);border-radius:16px;padding:14px;margin:14px 0}
.mbov .small{font-size:13px;color:var(--muted,#5b6e63)}
.mbov .err{color:#b3261e;font-size:14px;margin-top:8px}
.mbov .ok{color:#2e7d32;font-size:14px}
.mbov .bt{border:0;border-radius:999px;padding:10px 16px;font-weight:600;background:var(--ink,#17322a);color:var(--bg,#fff);font:inherit;font-weight:600}
.mbov .bt.ghost{background:none;color:inherit;border:1px solid var(--line,#cbd6c7)}
.mbov .bt.gold{background:var(--gold,#9a7414);color:#fff}
.mbov a{color:inherit}`;
function addCss(){if(document.getElementById('mbcss'))return;const st=document.createElement('style');st.id='mbcss';st.textContent=CSS;document.head.appendChild(st)}
let loginEl=null;
function showLogin(msg){
  if(loginEl)return;addCss();
  const cfgOk=SB_URL&&SB_KEY&&!/VOTRE|YOUR/i.test(SB_URL+SB_KEY);
  loginEl=document.createElement('div');loginEl.className='mbov';
  loginEl.innerHTML=`<div class="box"><h2>Mortel<i>book</i></h2><p class="small">Connecte-toi pour retrouver tes persos et ta sauvegarde.</p>
  ${cfgOk?'':'<p class="err">Le fichier config.js n’est pas encore rempli (adresse et clé Supabase). Suis l’étape 3 du guide.</p>'}
  <div class="sec"><label for="mbem">E-mail</label><input id="mbem" type="email" autocomplete="username">
  <label for="mbpw">Mot de passe</label><input id="mbpw" type="password" autocomplete="current-password">
  <div class="err" id="mberr">${esc(msg||'')}</div>
  <div class="row" style="margin-top:14px"><button class="bt ghost" id="mbsignup">Créer mon compte</button><button class="bt gold" id="mblogin">Se connecter</button></div></div></div>`;
  document.body.appendChild(loginEl);
  const go=async(kind)=>{
    const email=loginEl.querySelector('#mbem').value.trim(),password=loginEl.querySelector('#mbpw').value;
    const er=loginEl.querySelector('#mberr');er.textContent='';
    if(!email||!password){er.textContent='Renseigne ton e-mail et ton mot de passe.';return}
    try{
      if(kind==='signup'){const j=await authCall('signup',{email,password});if(!j.access_token){er.innerHTML='<span class="ok">Compte créé. Confirme ton e-mail (lien reçu), puis connecte-toi.</span>';return}saveSession(fromToken(j))}
      else saveSession(fromToken(await authCall('token?grant_type=password',{email,password})));
      loginEl.remove();loginEl=null;afterLogin();
    }catch(e){er.textContent=e.message||'Connexion impossible.'}
  };
  loginEl.querySelector('#mblogin').onclick=()=>go('login');
  loginEl.querySelector('#mbsignup').onclick=()=>go('signup');
  loginEl.querySelector('#mbpw').addEventListener('keydown',e=>{if(e.key==='Enter')go('login')});
}
async function afterLogin(){
  try{const r=await kvGet('settings','ai');if(r&&r.keys&&(r.at||0)>(AI.at||0)){AI={keys:Object.assign({},DEFAULT_AI.keys,r.keys),routes:Object.assign({},JSON.parse(JSON.stringify(DEFAULT_AI.routes)),r.routes||{}),at:r.at};storeAI(false)}else if(AI.keys.gemini||AI.keys.openrouter)storeAI()}catch(e){}
  authResolve(true);
  if(!AI.keys.gemini&&!AI.keys.openrouter)setTimeout(()=>openSettings('Pour que les persos répondent, colle tes clés Gemini et OpenRouter.'),600);
}

/* ---------------- interface : réglages ⚙️ ---------------- */
let modelLists={gemini:null,openrouter:null};
async function loadModelLists(){
  const out={};
  if(AI.keys.gemini){try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers:{'x-goog-api-key':AI.keys.gemini}});const j=await r.json();out.gemini=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>({id:m.name.replace(/^models\//,''),label:m.displayName||''}))}catch(e){out.gemini=null}}
  try{const r=await fetch('https://openrouter.ai/api/v1/models');const j=await r.json();out.openrouter=(j.data||[]).map(m=>{const pi=+m.pricing.prompt*1e6,po=+m.pricing.completion*1e6;return{id:m.id,label:(pi===0&&po===0)?'gratuit':`${pi.toFixed(2)} $ / ${po.toFixed(2)} $ par M`}})}catch(e){out.openrouter=null}
  modelLists=Object.assign(modelLists,out);
}
let setEl=null;
function openSettings(msg){
  if(setEl)return;addCss();
  setEl=document.createElement('div');setEl.className='mbov';
  const opt=(list,p)=>list?`<datalist id="dl-${p}">${list.map(m=>`<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</datalist>`:'';
  const draw=()=>{
    setEl.innerHTML=`<div class="box"><div class="row" style="justify-content:space-between"><h2 style="flex:0 1 auto">⚙️ Réglages IA</h2><button class="bt ghost" id="mbclose" style="flex:0 0 auto">Fermer</button></div>
    ${msg?`<p class="ok">${esc(msg)}</p>`:''}
    <div class="sec"><b>Clés API</b><p class="small">Elles restent dans ton compte (visibles par toi seule).</p>
      <label for="kgem">Clé Gemini (gratuite) · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">en obtenir une</a></label><input id="kgem" type="password" value="${esc(AI.keys.gemini)}" placeholder="AIza…">
      <label for="kor">Clé OpenRouter · <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener">en obtenir une</a></label><input id="kor" type="password" value="${esc(AI.keys.openrouter)}" placeholder="sk-or-…"></div>
    <div class="sec"><b>Modèle par usage</b><p class="small">Gemini = gratuit (avec limites). OpenRouter = le modèle choisi, gratuit s'il finit par « :free ». Tu peux mettre plusieurs modèles séparés par des virgules : si le premier est saturé, l'appli essaie le suivant.</p>
      ${ROUTES.map(r=>{const v=AI.routes[r.k]||{};return `<label>${r.label}</label><div class="small">${r.hint}</div><div class="row" style="margin-top:6px"><select data-rp="${r.k}" style="flex:0 0 38%"><option value="gemini"${v.p==='gemini'?' selected':''}>Gemini</option><option value="openrouter"${v.p==='openrouter'?' selected':''}>OpenRouter</option>${r.k==='fallback'?`<option value="none"${v.p==='none'?' selected':''}>Aucun</option>`:''}</select><input data-rm="${r.k}" value="${esc(v.m||'')}" title="Plusieurs modèles possibles, séparés par des virgules" list="dl-${v.p==='openrouter'?'openrouter':'gemini'}" placeholder="nom du modèle"></div><div class="row" style="margin-top:6px"><span class="small" id="tr-${r.k}"></span><button class="bt ghost" data-test="${r.k}" style="flex:0 0 auto;padding:6px 12px">Tester</button></div>`}).join('')}
      ${opt(modelLists.gemini,'gemini')}${opt(modelLists.openrouter,'openrouter')}
      <div class="row" style="margin-top:12px"><span class="small" id="mllist">${modelLists.openrouter?'Listes de modèles chargées : commence à taper un nom pour voir les suggestions.':''}</span><button class="bt ghost" id="mbload" style="flex:0 0 auto">🔄 Charger les modèles</button></div></div>
    <div class="row"><span></span><button class="bt gold" id="mbsave" style="flex:0 0 auto">Enregistrer</button></div>
    <div class="sec"><b>📦 Importer mes données</b><p class="small">Le fichier exporté depuis Mortelbook dans Claude (Profil → Exporter mes données). Il remplace tout ce qu'il y a dans cette appli.</p><input type="file" id="mbfile" accept=".json,application/json"><div class="small" id="mbimp"></div></div>
    <div class="sec"><b>Compte</b><p class="small">${esc(session&&session.user.email||'')}</p><button class="bt ghost" id="mbout">Se déconnecter</button></div></div>`;
  };
  const collect=()=>{
    AI.keys.gemini=setEl.querySelector('#kgem').value.trim();AI.keys.openrouter=setEl.querySelector('#kor').value.trim();
    setEl.querySelectorAll('[data-rp]').forEach(s=>{const k=s.dataset.rp;AI.routes[k]=AI.routes[k]||{};AI.routes[k].p=s.value});
    setEl.querySelectorAll('[data-rm]').forEach(i=>{AI.routes[i.dataset.rm].m=i.value.trim()});
  };
  draw();document.body.appendChild(setEl);
  setEl.addEventListener('change',e=>{if(e.target.id==='mbfile')return;collect();storeAI();if(e.target.dataset.rp)draw()});
  setEl.addEventListener('click',async e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.id==='mbclose'){collect();storeAI();setEl.remove();setEl=null}
    else if(t.id==='mbsave'){collect();storeAI();msg='Réglages enregistrés.';draw()}
    else if(t.id==='mbload'){collect();t.disabled=true;t.textContent='Chargement…';await loadModelLists();draw()}
    else if(t.dataset.test){collect();storeAI();const k=t.dataset.test;const out=setEl.querySelector('#tr-'+k);out.textContent='Test en cours…';const t0=Date.now();
      try{const r=await callRoute(AI.routes[k],'Réponds uniquement par : « Bonjour Sandra ! »',{maxTokens:200});out.innerHTML=`<span class="ok">✓ ${esc(r.text.trim().slice(0,60))} (${((Date.now()-t0)/1000).toFixed(1)} s)</span>`}
      catch(err){out.innerHTML=`<span class="err">✗ ${esc(err.code)} ${esc((err.message||'').slice(0,140))}</span>`}}
    else if(t.id==='mbout'){saveSession(null);location.reload()}
  });
  setEl.querySelector('#mbfile')&&setEl.addEventListener('input',async e=>{if(e.target.id!=='mbfile'||!e.target.files[0])return;const out=setEl.querySelector('#mbimp');collect();storeAI();try{await importFile(e.target.files[0],m=>out.textContent=m)}catch(err){out.innerHTML=`<span class="err">${esc(err.message||err)}</span>`}});
}

/* ---------------- import ---------------- */
async function importFile(file,progress){
  const j=JSON.parse(await file.text());
  if(!j||j.app!=='mortelbook'||!j.state||!Array.isArray(j.state.chars))throw new Error('Ce fichier ne ressemble pas à un export Mortelbook.');
  if(!confirmImport())return;
  await authReady;
  const coll='data/users/'+session.user.id,at=Date.now();
  const st=j.state;delete st.fresh;st.sid='import-'+at;st.savedAt=at;st.lastSeen=at;
  const main=Object.assign({},st,{dms:{},groups:(st.groups||[]).map(g=>Object.assign({},g,{msgs:[]}))});
  const rows=[{coll,id:'state',data:{s:JSON.stringify(main),at}}];
  Object.keys(st.dms||{}).forEach(cid=>rows.push({coll,id:'dm-'+cid,data:{s:JSON.stringify(st.dms[cid]||[]),at}}));
  (st.groups||[]).forEach(g=>rows.push({coll,id:'grp-'+g.id,data:{s:JSON.stringify(g.msgs||[]),at}}));
  Object.keys(j.bodies||{}).forEach(id=>rows.push({coll,id:'story-'+id,data:{s:JSON.stringify(j.bodies[id]),at}}));
  progress('Suppression de l’ancienne sauvegarde…');
  await rest('DELETE',`?coll=eq.${q(coll)}`,null,{Prefer:'return=minimal'});
  progress(`Envoi de ${rows.length} éléments…`);
  await kvSetMany(rows);
  try{Object.keys(localStorage).forEach(k=>{if(k==='mortelbook-v1'||k.startsWith('mb-story-'))localStorage.removeItem(k)})}catch(e){}
  progress(`✓ Import terminé : ${st.chars.length} persos, ${Object.keys(j.bodies||{}).length} histoires. Rechargement…`);
  setTimeout(()=>location.reload(),1200);
}
function confirmImport(){return true}

/* ---------------- démarrage ---------------- */
window.MB=Object.freeze({openSettings:()=>openSettings(),lastModel});
function boot(){
  if(session&&session.refresh_token){token().then(()=>afterLogin()).catch(()=>{if(!session)return;afterLogin()})}
  else showLogin();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
