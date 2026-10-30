
/* Химический тренажёр — Supabase client. Never place service_role keys in browser code. */
"use strict";
const SUPABASE_URL="https://jjfuhqntmszksptaubeg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_qa1uohdpDbS9jp11DQi7gQ_b_OaceAK";
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const $=id=>document.getElementById(id);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid=p=>(p||"id")+"_"+crypto.randomUUID().slice(0,8);
let user=null,profile=null,fullAccess=false,course={programs:[]},progress={},selected=null,activeSectionId=null,toastTimer,editorOpen=false,booting=false;

function notify(s){$("toast").textContent=s;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),3500)}
function msg(s){$("authMsg").textContent=s||""}
function admin(){return profile?.role==="admin"}
async function dataOrThrow(r){if(r.error)throw r.error;return r.data}
function programIsFree(p){if(typeof p?.isFree==="boolean")return p.isFree;return course.programs.findIndex(x=>x.id===p?.id)===0}
function canOpen(p){return !!p&&(admin()||programIsFree(p)||fullAccess)}
function allQuestions(){return course.programs.flatMap(p=>(p.sections||[]).flatMap(s=>s.questions||[]))}
function findSection(id){for(const p of course.programs){const s=(p.sections||[]).find(s=>s.id===id);if(s)return s}return null}
function rubricNumber(s,i){const v=s?.rubricNumber;return v!==undefined&&v!==null&&String(v).trim()!==""?String(v).trim():String(i+1)}
function findRubricByNumber(p,n){const wanted=String(n??"").trim();return wanted?(p.sections||[]).find((s,i)=>rubricNumber(s,i)===wanted)||null:null}
function sectionComplete(s){return !!s&&(s.questions||[]).length>0&&(s.questions||[]).every(q=>progress[q.id]?.answered)}
function transitionTarget(p,s){const n=s?.nextRubricNumber;if(n===undefined||n===null||String(n).trim()==="")return null;return findRubricByNumber(p,n)}
function normalizeAnswer(v){return String(v??"").trim().toLocaleLowerCase().replace(/[\s\u00a0]+/g," ").replace(/[.!?;:,]+$/g,"")}

async function signUp(){
  msg("");const email=$("email").value.trim(),password=$("password").value;
  if(password.length<8){msg("Пароль должен содержать не менее 8 символов.");return}
  try{const {data,error}=await sb.auth.signUp({email,password});if(error)throw error;if(data.session)await boot(data.user);else msg("Аккаунт создан. Проверь почту, подтверди адрес и затем войди.")}
  catch(e){msg("Ошибка регистрации: "+e.message)}
}
async function signIn(e){
  e.preventDefault();msg("");
  try{const {data,error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});if(error)throw error;await boot(data.user)}
  catch(e2){msg("Не удалось войти: "+e2.message)}
}
async function boot(u){
  if(booting)return;booting=true;user=u;
  try{
    profile=await dataOrThrow(await sb.from("profiles").select("id,email,role").eq("id",u.id).single());
    const access=await dataOrThrow(await sb.from("user_access").select("full_access").eq("user_id",u.id).maybeSingle());
    fullAccess=!!access?.full_access||admin();
    course=await dataOrThrow(await sb.rpc("get_course_data"))||{programs:[]};
    if(!Array.isArray(course.programs))course.programs=[];
    const saved=await dataOrThrow(await sb.from("user_progress").select("data").eq("user_id",u.id).maybeSingle());
    progress=saved?.data&&typeof saved.data==="object"?saved.data:{};
    $("auth").classList.add("hidden");$("app").classList.remove("hidden");
    $("badge").textContent=(u.email||"")+(admin()?" · АДМИНИСТРАТОР":fullAccess?" · ПОЛНЫЙ ДОСТУП":"");
    document.querySelectorAll(".admin").forEach(el=>el.classList.toggle("hidden",!admin()));
    if(!course.programs.some(p=>p.id===selected&&canOpen(p)))selected=(course.programs.find(canOpen)||course.programs[0])?.id||null;
    const p=course.programs.find(p=>p.id===selected);
    if(!p||!p.sections?.some(s=>s.id===activeSectionId))activeSectionId=p?.sections?.[0]?.id||null;
    render();
  }catch(e){msg("Ошибка загрузки. Проверь настройки Supabase и SQL: "+e.message);console.error(e)}
  finally{booting=false}
}
async function logout(){await sb.auth.signOut();user=null;profile=null;fullAccess=false;progress={};selected=null;activeSectionId=null;$("app").classList.add("hidden");$("auth").classList.remove("hidden");$("badge").textContent=""}
async function saveCourse(){if(!admin())throw Error("Редактировать курс может только администратор.");const {error}=await sb.from("course_state").upsert({id:1,data:course,updated_at:new Date().toISOString()});if(error)throw error}
async function saveProgress(){if(!user)throw Error("Нужно войти в аккаунт.");const {error}=await sb.from("user_progress").upsert({user_id:user.id,data:progress,updated_at:new Date().toISOString()});if(error)throw error}
async function changed(text){
  const beforeProgram=selected,beforeSection=activeSectionId;
  try{await saveCourse();selected=beforeProgram;activeSectionId=beforeSection;render();notify(text)}
  catch(e){selected=beforeProgram;activeSectionId=beforeSection;notify("Ошибка сохранения: "+e.message);console.error(e)}
}
function render(){
  renderPrograms();renderPromo();renderLesson();
  const done=course.programs.filter(p=>(p.sections||[]).length&&p.sections.every(s=>(s.questions||[]).length&&s.questions.every(q=>["essay","free_text"].includes(q.type)?!!progress[q.id]?.answered:!!progress[q.id]?.correct))).length;
  $("progress").textContent=`Программ пройдено: ${done} / ${course.programs.length}`;
}
function renderPrograms(){
  const query=($("search").value||"").toLowerCase().trim();
  const list=course.programs.filter(p=>(p.title||"").toLowerCase().includes(query));
  $("programs").innerHTML=list.length?list.map(p=>`<button class="program ${p.id===selected?"active":""} ${canOpen(p)?"":"locked"}" data-p="${esc(p.id)}"><span>${canOpen(p)?"📘":"🔒"} ${esc(p.title)}</span><small class="access-label ${programIsFree(p)?"free-label":"paid-label"}">${programIsFree(p)?"Бесплатная":"Платная"}</small></button>`).join(""):`<div class="panel">${course.programs.length?"Ничего не найдено.":"Курс пока пуст."}</div>`;
  $("programs").querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{const p=course.programs.find(x=>x.id===b.dataset.p);if(!canOpen(p)){notify("Эта программа закрыта. Нужен промокод или полный доступ.");return}selected=p.id;activeSectionId=p.sections?.[0]?.id||null;$("adminPanel").classList.add("hidden");$("lesson").classList.remove("hidden");render()});
}
function renderPromo(){
  if(admin()||fullAccess){$("promoBox").innerHTML="";return}
  $("promoBox").innerHTML=`<div class="notice"><b>Бесплатные программы доступны всем.</b><p>Есть промокод? Введи его ниже.</p><form id="promoForm"><input id="promoInput" placeholder="Промокод" required><button type="submit">Активировать</button></form></div>`;
  $("promoForm").onsubmit=async e=>{e.preventDefault();try{const {error}=await sb.rpc("redeem_course_promo",{p_code:$("promoInput").value.trim().toUpperCase()});if(error)throw error;fullAccess=true;course=await dataOrThrow(await sb.rpc("get_course_data"))||{programs:[]};if(!Array.isArray(course.programs))course.programs=[];$("badge").textContent=(user.email||"")+" · ПОЛНЫЙ ДОСТУП";render();notify("Полный доступ открыт!")}catch(err){notify(err.message||"Не удалось активировать промокод.")}};
}
function renderInlineTask(q,responses=[],editable=false){
  const parts=String(q.text||"").split("{{input}}");
  return parts.map((part,i)=>`${esc(part)}${i<parts.length-1?`<input class="inline-answer-input" type="text" ${editable?`name="blank${i}" data-blank="${i}" required`:`value="${esc(responses[i]||"")}" disabled`} aria-label="Ответ ${i+1}" placeholder="Впиши ответ">`:""}`).join("");
}

/* Обновлено: кнопки редактирования и удаления задания явно видны администратору. */
function renderQuestionHTML(q,qi){
  const r=progress[q.id],inline=q.type==="text"&&String(q.text||"").includes("{{input}}"),free=q.type==="essay"||q.type==="free_text";
  let body="";
  if(inline){
    body=r?.answered?`<div class="submitted-answer"><div class="inline-task-text">${renderInlineTask(q,r.responses||[])}</div><div class="feedback ${r.correct?"correct":"wrong"}"><b>${r.correct?"Правильно!":"Ответ не совпал с образцом."}</b> ${esc(q.explanation||"")}</div>${admin()?`<p><b>Правильный ответ:</b> ${esc((q.acceptedAnswers||[]).map(a=>Array.isArray(a)?a.join(" / "):a).join("; "))}</p>`:""}</div>`:`<form class="free-answer-form inline-answer-form" data-inline-answer="${esc(q.id)}"><div class="inline-task-text">${renderInlineTask(q,[],true)}</div><button type="submit">Проверить ответ</button></form>`;
  }else if(free){
    body=r?.answered?`<div class="submitted-answer"><b>Твой ответ:</b><p>${esc(r.response||"")}</p><div class="feedback"><b>Ответ сохранён.</b> ${esc(q.explanation||"Проверь его по инструкции учебника.")}</div>${q.modelAnswer?`<p><b>Ответ для самостоятельной проверки:</b><br>${esc(q.modelAnswer)}</p>`:""}</div>`:`<form class="free-answer-form" data-free-answer="${esc(q.id)}"><label class="answer-label" for="answer-${esc(q.id)}">Твой ответ</label><textarea id="answer-${esc(q.id)}" name="response" rows="4" required placeholder="Напиши ответ своими словами..."></textarea><button type="submit">Сохранить ответ</button></form>`;
  }else if(q.type==="route"){
    body=r?.answered
      ? `<div class="submitted-answer"><p><b>Выбранный вариант:</b> ${esc(q.options?.[r.selected]||"")}</p><div class="feedback">Маршрут выбран.</div></div>`
      : `<form class="free-answer-form route-answer-form" data-route-answer="${esc(q.id)}"><div class="options">${(q.options||[]).map((o,i)=>`<label class="option route-option"><input type="radio" name="routeChoice" value="${i}" required><span>${esc(o)}</span></label>`).join("")}</div><button type="submit">Продолжить</button></form>`;
  }else{
    body=`<div class="options">${(q.options||[]).map((o,i)=>`<button class="option ${r?.answered?(i===q.answer?"good":i===r.selected?"bad":""):""}" data-answer="${esc(q.id)}" data-index="${i}" ${r?.answered?"disabled":""}>${esc(o)}</button>`).join("")}</div>${r?.answered?`<div class="feedback ${r.correct?"correct":"wrong"}"><b>${r.correct?"Правильно!":"Неправильно."}</b> ${esc(q.explanation||"")}</div>`:""}`;
  }
  return `<div class="question" data-q="${esc(q.id)}"><b>${qi+1}. ${esc(inline?"":q.text)}</b>${body}${admin()?`<div class="admin-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button type="button" class="light" data-editq="${esc(q.id)}">Редактировать задание</button><button type="button" class="danger" data-delq="${esc(q.id)}">Удалить задание</button></div>`:""}</div>`;
}
function renderLesson(){
  const p=course.programs.find(x=>x.id===selected);
  if(!p){$("lesson").innerHTML="<div class='panel'>Выбери программу.</div>";return}
  if(!canOpen(p)){$("lesson").innerHTML="<div class='panel'><h2>Программа закрыта</h2><p>Введи промокод, чтобы получить доступ.</p></div>";return}
  const sections=p.sections||[];
  if(!activeSectionId||!sections.some(s=>s.id===activeSectionId))activeSectionId=sections[0]?.id||null;
  if(!sections.length){$("lesson").innerHTML="<div class='panel'>В этой программе пока нет рубрик.</div>";renderAdminPanel(p);return}
  const s=sections.find(x=>x.id===activeSectionId)||sections[0],idx=sections.indexOf(s);
  const done=sectionComplete(s),target=transitionTarget(p,s);
  $("lesson").innerHTML=`<div class="section"><div class="section-head"><div><h2>${esc(s.title||"Рубрика")}</h2><p>${esc(s.description||"")}</p></div>${admin()?`<span class="small-note">Рубрика № ${esc(rubricNumber(s,idx))}</span>`:""}</div>${(s.questions||[]).map((q,i)=>renderQuestionHTML(q,i)).join("")||"<p>Заданий пока нет.</p>"}${!admin()&&done&&target?`<button id="nextRubric">Перейти дальше</button>`:""}</div>`;
  $("lesson").querySelectorAll("[data-answer]").forEach(b=>b.onclick=()=>answerChoice(b.dataset.answer,Number(b.dataset.index)));
  $("lesson").querySelectorAll("[data-free-answer]").forEach(f=>f.onsubmit=e=>{e.preventDefault();saveFreeAnswer(f.dataset.freeAnswer,new FormData(f).get("response"))});
  $("lesson").querySelectorAll("[data-inline-answer]").forEach(f=>f.onsubmit=e=>{e.preventDefault();const q=findQuestion(f.dataset.inlineAnswer)?.question;if(!q)return;const count=(q.text.match(/\{\{input\}\}/g)||[]).length;const responses=Array.from({length:count},(_,i)=>f.querySelector(`[name="blank${i}"]`)?.value||"");checkInlineAnswer(q,responses)});
  $("lesson").querySelectorAll("[data-route-answer]").forEach(f=>f.onsubmit=e=>{e.preventDefault();const v=f.querySelector('input[name="routeChoice"]:checked');if(!v){notify("Выбери вариант ответа.");return}chooseRoute(f.dataset.routeAnswer,Number(v.value))});
  $("lesson").querySelectorAll("[data-editq]").forEach(b=>b.onclick=()=>editQuestion(b.dataset.editq));
  $("lesson").querySelectorAll("[data-delq]").forEach(b=>b.onclick=()=>deleteQuestion(b.dataset.delq));
  $("lesson").querySelectorAll("[data-edit-section]").forEach(b=>b.onclick=()=>editSection(b.dataset.editSection));
  $("lesson").querySelectorAll("[data-delete-section]").forEach(b=>b.onclick=()=>deleteSection(b.dataset.deleteSection));
  $("lesson").querySelectorAll("[data-addq]").forEach(b=>b.onclick=()=>addQuestion(b.dataset.addq));
  $("lesson").querySelectorAll("[data-nav-section]").forEach(b=>b.onclick=()=>{activeSectionId=b.dataset.navSection;render()});
  const next=$("nextRubric");if(next)next.onclick=()=>{if(!target){notify("Следующая рубрика не найдена.");return}activeSectionId=target.id;render()};
  renderAdminPanel(p);
}
