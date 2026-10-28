/* Supabase-backed Chemistry Trainer. Never put secret/service_role keys here. */
"use strict";
const SUPABASE_URL = "https://jjfuhqntmszksptaubeg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qa1uohdpDbS9jp11DQi7gQ_b_OaceAK";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = p => (p || "id") + "_" + crypto.randomUUID().slice(0,8);
let user=null, profile=null, fullAccess=false, course={programs:[]}, progress={}, selected=null, activeSectionId=null, toastTimer;

function notify(s){$("toast").textContent=s;$("toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),3200)}
function msg(s){$("authMsg").textContent=s}
function admin(){return profile?.role==="admin"}
function programIsFree(p){
  // Старые программы без настройки сохраняют прежнее поведение: первая бесплатная, остальные платные.
  if(typeof p?.isFree === "boolean") return p.isFree;
  return course.programs.findIndex(x=>x.id===p?.id)===0;
}
function canOpen(p){return !!p && (admin() || programIsFree(p) || fullAccess)}
async function dataOrThrow(r){if(r.error)throw r.error;return r.data}

async function signUp(){
  msg(""); const email=$("email").value.trim(), password=$("password").value;
  if(password.length<8){msg("Пароль должен содержать не менее 8 символов.");return}
  try{
    const {data,error}=await sb.auth.signUp({email,password});if(error)throw error;
    if(data.session) await boot(data.user); else msg("Аккаунт создан. Проверь почту, подтверди адрес и затем войди.");
  }catch(e){msg("Ошибка регистрации: "+e.message)}
}
async function signIn(e){
  e.preventDefault();msg("");
  try{const {data,error}=await sb.auth.signInWithPassword({email:$("email").value.trim(),password:$("password").value});if(error)throw error;await boot(data.user)}
  catch(e2){msg("Не удалось войти: "+e2.message)}
}
async function boot(u){
  user=u;
  try{
    profile=await dataOrThrow(await sb.from("profiles").select("id,email,role").eq("id",u.id).single());
    const a=await dataOrThrow(await sb.from("user_access").select("full_access").eq("user_id",u.id).maybeSingle());
    fullAccess=!!a?.full_access||admin();
    const c=await dataOrThrow(await sb.rpc("get_course_data"));
    course=c||{programs:[]};if(!Array.isArray(course.programs))course.programs=[];
    const pr=await dataOrThrow(await sb.from("user_progress").select("data").eq("user_id",u.id).maybeSingle());
    progress=pr?.data||{};
    $("auth").classList.add("hidden");$("app").classList.remove("hidden");
    $("badge").textContent=(u.email||"")+(admin()?" · АДМИНИСТРАТОР":fullAccess?" · ПОЛНЫЙ ДОСТУП":"");
    document.querySelectorAll(".admin").forEach(x=>x.classList.toggle("hidden",!admin()));
    if(!course.programs.some(p=>p.id===selected))selected=(course.programs.find(p=>canOpen(p))||course.programs[0])?.id||null;
    render();
  }catch(e){msg("Ошибка загрузки. Проверь, что SQL выполнен полностью: "+e.message);console.error(e)}
}
async function logout(){
  await sb.auth.signOut();user=null;profile=null;fullAccess=false;progress={};
  $("app").classList.add("hidden");$("auth").classList.remove("hidden");$("badge").textContent="";
}
async function saveCourse(){
  if(!admin())throw Error("Редактировать курс может только администратор.");
  const {error}=await sb.from("course_state").upsert({id:1,data:course,updated_at:new Date().toISOString()});
  if(error)throw error;
}
async function saveProgress(){
  const {error}=await sb.from("user_progress").upsert({user_id:user.id,data:progress,updated_at:new Date().toISOString()});
  if(error)throw error;
}
async function changed(text){
  // Keep the current program and rubric selected while rerendering after edits.
  // Otherwise a freshly edited rubric could jump back to the first rubric.
  const programBeforeSave = selected;
  const rubricBeforeSave = activeSectionId;
  try{
    await saveCourse();
    selected = programBeforeSave;
    activeSectionId = rubricBeforeSave;
    render();
    notify(text);
  }catch(e){
    selected = programBeforeSave;
    activeSectionId = rubricBeforeSave;
    notify("Ошибка сохранения: "+e.message);
    console.error(e);
  }
}
function allQuestions(){return course.programs.flatMap(p=>(p.sections||[]).flatMap(s=>s.questions||[]))}
function findSection(id){for(const p of course.programs){const s=(p.sections||[]).find(s=>s.id===id);if(s)return s}return null}
function render(){
  renderPrograms();renderPromo();renderLesson();
  const done=course.programs.filter(p=>(p.sections||[]).length&&p.sections.every(s=>(s.questions||[]).length&&s.questions.every(q=>(q.type==="text"||q.type==="free_text")?!!progress[q.id]?.answered:!!progress[q.id]?.correct))).length;
  $("progress").textContent=`Программ пройдено: ${done} / ${course.programs.length}`;
}
function renderPrograms(){
  const q=($("search").value||"").toLowerCase().trim();
  const list=course.programs.filter(p=>(p.title||"").toLowerCase().includes(q));
  $("programs").innerHTML=list.length?list.map(p=>`<button class="program ${p.id===selected?"active":""} ${canOpen(p)?"":"locked"}" data-p="${esc(p.id)}"><span>${canOpen(p)?"📘":"🔒"} ${esc(p.title)}</span><small class="access-label ${programIsFree(p)?"free-label":"paid-label"}">${programIsFree(p)?"Бесплатная":"Платная"}</small></button>`).join(""):`<div class="panel">${course.programs.length?"Ничего не найдено.":"Курс пока пуст."}</div>`;
  $("programs").querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{const p=course.programs.find(x=>x.id===b.dataset.p);if(!canOpen(p)){notify("Эта программа закрыта. Нужен промокод.");return}selected=p.id;activeSectionId=(p.sections||[])[0]?.id||null;$("adminPanel").classList.add("hidden");$("lesson").classList.remove("hidden");render()});
}
function renderPromo(){
  if(admin()||fullAccess){$("promoBox").innerHTML="";return}
  $("promoBox").innerHTML=`<div class="notice"><b>Бесплатно доступна первая программа.</b><p>Есть промокод? Введи его ниже.</p><form id="promoForm"><input id="promoInput" placeholder="Промокод" required><button>Активировать</button></form></div>`;
  $("promoForm").onsubmit=async e=>{e.preventDefault();try{
    const {error}=await sb.rpc("redeem_course_promo",{p_code:$("promoInput").value.trim().toUpperCase()});if(error)throw error;
    fullAccess=true;
    course=await dataOrThrow(await sb.rpc("get_course_data"));
    if(!Array.isArray(course.programs))course.programs=[];
    $("badge").textContent=(user.email||"")+" · ПОЛНЫЙ ДОСТУП";render();notify("Полный доступ открыт!");
  }catch(err){notify(err.message||"Не удалось активировать промокод.")}};
}
function rubricNumber(section, index){
  const value=section.rubricNumber;
  return value!==undefined && value!==null && String(value).trim()!=="" ? String(value).trim() : String(index+1);
}
function findRubricByNumber(program, number){
  const wanted=String(number ?? "").trim();
  if(!wanted)return null;
  return (program.sections||[]).find((section,index)=>rubricNumber(section,index)===wanted)||null;
}
function renderLesson(){
  const el=$("lesson"),p=course.programs.find(p=>p.id===selected);
  if(!p){el.innerHTML=`<div class="panel"><h2>Химический тренажёр</h2><p>${admin()?"Создай первую программу кнопкой слева.":"Администратор ещё не добавил программы."}</p></div>`;return}
  if(!canOpen(p)){el.innerHTML='<div class="panel"><h2>Программа закрыта</h2><p>Для доступа нужен промокод.</p></div>';return}
  const pi=course.programs.indexOf(p), sections=p.sections||[];
  if(!sections.some(s=>s.id===activeSectionId))activeSectionId=sections[0]?.id||null;
  const active=sections.find(s=>s.id===activeSectionId)||null;
  const activeIndex=active?sections.indexOf(active):-1;
  el.innerHTML=`<div class="lesson-head"><small>ПРОГРАММА ${pi+1} ИЗ ${course.programs.length}</small><h2>${esc(p.title)}</h2><p>${esc(p.description||"")}</p></div>
  ${sections.length?`<div class="rubric-layout">${admin()?`<nav class="rubric-nav" aria-label="Рубрики">${sections.map((s,i)=>`<button type="button" class="rubric-link ${s.id===activeSectionId?"active":""}" data-rubric="${esc(s.id)}"><span>Рубрика ${esc(rubricNumber(s,i))}</span><small>${esc(s.title||"Без названия")}</small></button>`).join("")}</nav>`:""}
  <article class="section rubric-content ${admin()?"":"student-rubric-content"}"><div class="rubric-topline"><small>РУБРИКА ${esc(rubricNumber(active,activeIndex))}</small>${active?.nextRubricNumber?`<span class="transition-note">После ответа → рубрика ${esc(active.nextRubricNumber)}</span>`:""}</div><h3>${esc(active?.title||"")}</h3><div class="theory">${esc(active?.text||"")}</div>
  ${(active?.questions||[]).map((q,qi)=>{const r=progress[q.id];const free=q.type==="text"||q.type==="free_text";return `<div class="question" data-q="${esc(q.id)}"><b>${qi+1}. ${esc(q.text)}</b>
    ${free?`${r?.answered?`<div class="submitted-answer"><b>Твой ответ:</b><p>${esc(r.response||"")}</p><div class="feedback"><b>Ответ сохранён.</b>${q.explanation?` ${esc(q.explanation)}`:" Проверить его нужно по инструкции учебника."}</div>${q.modelAnswer?`<p><b>Ответ для проверки:</b> ${esc(q.modelAnswer)}</p>`:""}</div>`:`<form class="free-answer-form" data-free-answer="${esc(q.id)}"><label class="answer-label" for="answer-${esc(q.id)}">Твой ответ</label><textarea id="answer-${esc(q.id)}" name="response" rows="4" required placeholder="Напиши ответ своими словами..."></textarea><button type="submit">Сохранить ответ</button></form>`}`
    :`<div class="options">${(q.options||[]).map((o,oi)=>`<button class="option ${r&&oi===q.answer?"good":r&&oi===r.selected?"bad":""}" data-a="${oi}" ${r?"disabled":""}>${esc(o)}</button>`).join("")}</div>${r?`<div class="feedback ${r.correct?"correct":"wrong"}"><b>${r.correct?"Правильно!":"Неправильно."}</b> ${esc(q.explanation||"")}${!r.correct?`<p>Правильный ответ: ${esc(q.options[q.answer]||"")}</p>`:""}</div>`:""}`}
  </div>`}).join("")}
  ${admin()?`<div class="rubric-navigation-buttons">${activeIndex>0?`<button type="button" class="light" id="prevRubric">← Предыдущая рубрика</button>`:""}${activeIndex>=0&&activeIndex<sections.length-1?`<button type="button" class="light" id="nextRubric">Следующая по списку →</button>`:""}</div>`:""}
  ${admin()?`<div class="admin-actions"><button data-addq="${esc(active.id)}">+ Задание</button><button data-edits="${esc(active.id)}">Изменить рубрику</button><button class="danger" data-dels="${esc(active.id)}">Удалить рубрику</button></div>`:""}</article></div>`:`<div class="panel">В этой программе пока нет рубрик.</div>`}
  ${admin()?`<div class="panel"><h3>Управление программой</h3><div class="admin-actions"><button id="addSection">+ Рубрика</button><button id="editProgram">Изменить программу</button><button class="danger" id="deleteProgram">Удалить программу</button></div></div>`:""}`;

  el.querySelectorAll("[data-rubric]").forEach(b=>b.onclick=()=>{activeSectionId=b.dataset.rubric;renderLesson()});
  el.querySelectorAll("[data-q]").forEach(qel=>qel.querySelectorAll("[data-a]").forEach(b=>b.onclick=async()=>{
    const q=allQuestions().find(x=>x.id===qel.dataset.q);if(!q||progress[q.id])return;
    const a=Number(b.dataset.a);progress[q.id]={selected:a,correct:a===Number(q.answer),answered:true,date:new Date().toISOString()};
    await submitQuestionAnswer(q,progress[q.id]);
  }));
  el.querySelectorAll("[data-free-answer]").forEach(form=>form.onsubmit=async e=>{
    e.preventDefault();const q=allQuestions().find(x=>x.id===form.dataset.freeAnswer);if(!q||progress[q.id])return;
    const response=new FormData(form).get("response").toString().trim();if(!response){notify("Напиши ответ перед сохранением.");return}
    progress[q.id]={response,answered:true,correct:false,date:new Date().toISOString()};
    await submitQuestionAnswer(q,progress[q.id]);
  });
  el.querySelectorAll("[data-addq]").forEach(b=>b.onclick=()=>addQuestion(b.dataset.addq));
  el.querySelectorAll("[data-edits]").forEach(b=>b.onclick=()=>editSection(b.dataset.edits));
  el.querySelectorAll("[data-dels]").forEach(b=>b.onclick=()=>deleteSection(b.dataset.dels));
  $("prevRubric")?.addEventListener("click",()=>{if(activeIndex>0){activeSectionId=sections[activeIndex-1].id;renderLesson()}});
  $("nextRubric")?.addEventListener("click",()=>{if(activeIndex>=0&&activeIndex<sections.length-1){activeSectionId=sections[activeIndex+1].id;renderLesson()}});
  $("addSection")?.addEventListener("click",addSection);
  $("editProgram")?.addEventListener("click",()=>editProgram(p.id));
  $("deleteProgram")?.addEventListener("click",()=>deleteProgram(p.id));
}
async function submitQuestionAnswer(q,answerRecord){
  try{
    await saveProgress();
    const p=course.programs.find(x=>x.id===selected);
    const active=findSection(activeSectionId);
    const targetNumber=active?.nextRubricNumber;
    if(targetNumber!==undefined&&targetNumber!==null&&String(targetNumber).trim()!==""){
      const target=findRubricByNumber(p,targetNumber);
      if(target){activeSectionId=target.id;renderLesson();notify(`Ответ сохранён. Переход к рубрике ${String(targetNumber).trim()}.`)}
      else{renderLesson();notify(`Ответ сохранён. Рубрика с номером ${String(targetNumber).trim()} не найдена; переход не выполнен.`)}
    }else renderLesson();
  }catch(e){delete progress[q.id];notify("Ошибка сохранения ответа: "+e.message)}
}
function openEditor(title, fields, initial={}){
  return new Promise(resolve=>{
    const backdrop=$("editorBackdrop"), form=$("editorForm"), fieldsEl=$("editorFields");
    $("editorTitle").textContent=title; fieldsEl.innerHTML="";
    fields.forEach(f=>{
      const value=initial[f.name] ?? f.value ?? "";
      const label=document.createElement("label");
      label.innerHTML=esc(f.label)+(f.required?' <span aria-hidden="true">*</span>':'');
      let input;
      if(f.type==="textarea"){
        input=document.createElement("textarea"); input.rows=f.rows||5; input.value=value;
        if(f.compact)input.className="compact-textarea";
      }else if(f.type==="select"){
        input=document.createElement("select");
        (f.options||[]).forEach(opt=>{const option=document.createElement("option");option.value=opt.value;option.textContent=opt.label;input.appendChild(option)});
        input.value=value||f.options?.[0]?.value||"";
      }else{
        input=document.createElement("input"); input.type=f.type||"text"; input.value=value;
        if(f.min!==undefined)input.min=f.min;
        if(f.maxlength)input.maxLength=f.maxlength;
      }
      input.id="editor_"+f.name; input.name=f.name; input.required=!!f.required;
      if(f.placeholder&&"placeholder" in input)input.placeholder=f.placeholder;
      label.appendChild(input);
      if(f.help){const help=document.createElement("span");help.className="field-help";help.textContent=f.help;label.appendChild(help)}
      fieldsEl.appendChild(label);
    });
    backdrop.classList.remove("hidden");
    const first=fieldsEl.querySelector("input,textarea"); if(first)first.focus();
    let finished=false;
    const cleanup=value=>{if(finished)return;finished=true;backdrop.classList.add("hidden");form.removeEventListener("submit",submit);$("editorClose").removeEventListener("click",cancel);$("editorCancel").removeEventListener("click",cancel);backdrop.removeEventListener("click",outside);document.removeEventListener("keydown",escape);resolve(value)};
    const cancel=()=>cleanup(null);
    const outside=e=>{if(e.target===backdrop)cancel()};
    const escape=e=>{if(e.key==="Escape")cancel()};
    const submit=e=>{e.preventDefault();if(!form.reportValidity())return;const values={};fields.forEach(f=>values[f.name]=$("editor_"+f.name).value);cleanup(values)};
    form.addEventListener("submit",submit);$("editorClose").addEventListener("click",cancel);$("editorCancel").addEventListener("click",cancel);backdrop.addEventListener("click",outside);document.addEventListener("keydown",escape);
  });
}
async function addProgram(){
  if(!admin())return;
  const v=await openEditor("Добавить программу",[
    {name:"title",label:"Название программы",required:true,placeholder:"Например, Основы химии"},
    {name:"description",label:"Краткое описание",type:"textarea",rows:3,placeholder:"Для чего эта программа и что изучит ученик"},
    {name:"access",label:"Доступ к программе",type:"select",value:"paid",options:[{value:"free",label:"Бесплатная — доступна всем"},{value:"paid",label:"Платная — нужен полный доступ / промокод"}],help:"Это настройка доступа, оплата на сайте автоматически не принимается."}
  ]);
  if(!v||!v.title.trim())return;
  const p={id:uid("program"),title:v.title.trim(),description:v.description.trim(),isFree:v.access==="free",sections:[]};course.programs.push(p);selected=p.id;activeSectionId=null;await changed("Программа создана.");
}
async function editProgram(id){
  const p=course.programs.find(x=>x.id===id);if(!admin()||!p)return;
  const v=await openEditor("Изменить программу",[
    {name:"title",label:"Название программы",required:true},
    {name:"description",label:"Краткое описание",type:"textarea",rows:3},
    {name:"access",label:"Доступ к программе",type:"select",value:programIsFree(p)?"free":"paid",options:[{value:"free",label:"Бесплатная — доступна всем"},{value:"paid",label:"Платная — нужен полный доступ / промокод"}],help:"Переключение на платную закроет её пользователям без полного доступа. Это не подключает онлайн-оплату."}
  ],{...p,access:programIsFree(p)?"free":"paid"});
  if(!v||!v.title.trim())return;p.title=v.title.trim();p.description=v.description.trim();p.isFree=v.access==="free";await changed("Программа обновлена.");
}
async function deleteProgram(id){
  const p=course.programs.find(x=>x.id===id);if(!admin()||!p||!confirm(`Удалить программу «${p.title}» вместе со всеми рубриками и вопросами? Это действие нельзя отменить.`))return;
  (p.sections||[]).flatMap(s=>s.questions||[]).forEach(q=>delete progress[q.id]);
  course.programs=course.programs.filter(x=>x.id!==id);selected=course.programs[0]?.id||null;activeSectionId=null;
  try{await saveCourse();await saveProgress();render();notify("Программа удалена.")}catch(e){notify(e.message)}
}
async function addSection(){
  const p=course.programs.find(p=>p.id===selected);if(!admin()||!p)return;
  const v=await openEditor("Добавить рубрику",[
    {name:"rubricNumber",label:"Индивидуальный номер рубрики",type:"number",required:true,value:String((p.sections||[]).length+1),help:"Этот номер используется для переходов. Он не обязан совпадать с позицией в списке."},
    {name:"title",label:"Название рубрики",required:true,placeholder:"Например, Строение вещества"},
    {name:"text",label:"Учебный текст / теория",type:"textarea",rows:9,help:"Можно вставить большой фрагмент текста. Переносы строк сохранятся."},
    {name:"nextRubricNumber",label:"Перейти к рубрике после ответа (необязательно)",type:"number",help:"Введи индивидуальный номер целевой рубрики, например 8. Номер не проверяется при сохранении — можно указать рубрику, которую добавишь позже."}
  ]);
  if(!v||!v.title.trim())return;
  p.sections||=[];
  const section={id:uid("section"),rubricNumber:v.rubricNumber.trim(),title:v.title.trim(),text:v.text,nextRubricNumber:v.nextRubricNumber.trim(),questions:[]};
  p.sections.push(section);activeSectionId=section.id;await changed("Рубрика добавлена.");
}
async function editSection(id){
  const s=findSection(id),p=course.programs.find(p=>(p.sections||[]).some(x=>x.id===id));if(!admin()||!s||!p)return;
  const v=await openEditor("Изменить рубрику",[
    {name:"rubricNumber",label:"Индивидуальный номер рубрики",type:"number",required:true,value:String(rubricNumber(s,p.sections.indexOf(s))),help:"Номер может отличаться от позиции рубрики в списке."},
    {name:"title",label:"Название рубрики",required:true},
    {name:"text",label:"Учебный текст / теория",type:"textarea",rows:12,help:"Переносы строк сохраняются."},
    {name:"nextRubricNumber",label:"Перейти к рубрике после ответа (необязательно)",type:"number",help:"Номер не проверяется при сохранении. Можно указать ещё не созданную рубрику."}
  ],{...s,rubricNumber:String(rubricNumber(s,p.sections.indexOf(s))),nextRubricNumber:s.nextRubricNumber??""});
  if(!v||!v.title.trim())return;
  s.rubricNumber=v.rubricNumber.trim();s.title=v.title.trim();s.text=v.text;s.nextRubricNumber=v.nextRubricNumber.trim();
  await changed("Рубрика изменена.");
}
async function deleteSection(id){
  const p=course.programs.find(p=>(p.sections||[]).some(s=>s.id===id)),s=findSection(id);
  if(!admin()||!p||!s||!confirm(`Удалить рубрику «${s.title}» и все её вопросы? Это действие нельзя отменить.`))return;
  (s.questions||[]).forEach(q=>delete progress[q.id]);p.sections=p.sections.filter(x=>x.id!==id);if(activeSectionId===id)activeSectionId=p.sections[0]?.id||null;
  try{await saveCourse();await saveProgress();render();notify("Рубрика удалена.")}catch(e){notify(e.message)}
}
async function addQuestion(id){
  const s=findSection(id);if(!admin()||!s)return;
  // Pin the editor to the rubric that launched it. This prevents the first
  // save from appearing to land in another rubric after the UI rerenders.
  const ownerProgram=course.programs.find(p=>(p.sections||[]).some(section=>section.id===id));
  if(!ownerProgram)return;
  selected=ownerProgram.id;
  activeSectionId=id;
  const kind=await openEditor("Выбери тип задания",[
    {name:"type",label:"Тип задания",type:"select",required:true,value:"choice",options:[
      {value:"choice",label:"Выбор одного правильного варианта"},
      {value:"text",label:"Ученик пишет ответ самостоятельно"}
    ]}
  ]);
  if(!kind)return;
  if(kind.type==="text"){
    const v=await openEditor("Задание со свободным ответом",[
      {name:"text",label:"Текст задания",type:"textarea",rows:5,required:true,help:"Например: Как называется вода в твёрдом состоянии? Ученик напишет ответ своими словами."},
      {name:"modelAnswer",label:"Ответ для самостоятельной проверки (необязательно)",type:"textarea",rows:3,help:"Показывается после отправки. Система не оценивает ответ автоматически."},
      {name:"explanation",label:"Дополнительная инструкция после ответа (необязательно)",type:"textarea",rows:3,help:"Например: Сравни свой ответ с ответом в рубрике 8."}
    ]);
    if(!v||!v.text.trim())return;
    s.questions||=[];
    s.questions.push({id:uid("question"),type:"text",text:v.text.trim(),modelAnswer:v.modelAnswer.trim(),explanation:v.explanation.trim()});
    selected=ownerProgram.id;activeSectionId=id;
    await changed("Задание со свободным ответом добавлено.");
    return;
  }
  const v=await openEditor("Добавить вопрос с вариантами",[
    {name:"text",label:"Текст вопроса / задания",type:"textarea",rows:4,required:true},
    {name:"options",label:"Варианты ответа — по одному на строку",type:"textarea",rows:5,required:true,value:"Вариант 1\nВариант 2\nВариант 3",help:"Поддерживается один правильный вариант."},
    {name:"answer",label:"Номер правильного варианта",type:"number",min:1,required:true,value:"1",help:"Нумерация начинается с 1."},
    {name:"explanation",label:"Объяснение ответа",type:"textarea",rows:4,help:"Показывается после выбора ответа."}
  ]);
  if(!v||!v.text.trim())return;
  const options=v.options.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(options.length<2){notify("Добавь минимум два варианта ответа — каждый с новой строки.");return}
  const n=Number(v.answer)-1;if(!Number.isInteger(n)||n<0||n>=options.length){notify(`Номер ответа должен быть от 1 до ${options.length}.`);return}
  s.questions||=[];s.questions.push({id:uid("question"),type:"choice",text:v.text.trim(),options,answer:n,explanation:v.explanation.trim()});selected=ownerProgram.id;activeSectionId=id;await changed("Вопрос добавлен.");
}
async function managePromos(){
  if(!admin())return;const panel=$("adminPanel");panel.classList.remove("hidden");$("lesson").classList.add("hidden");
  const promos=await dataOrThrow(await sb.from("promo_codes").select("*").order("created_at",{ascending:false}));
  panel.innerHTML=`<h2>Промокоды</h2><form id="makePromo"><label>Код<input id="promoCodeNew" required maxlength="40" placeholder="CHEM2026"></label><label>Лимит (0 — без лимита)<input id="promoLimitNew" type="number" min="0" value="1" required></label><button>Создать промокод</button></form>
  <h3>Список</h3>${promos.length?promos.map(p=>`<div class="admin-row"><span><b>${esc(p.code)}</b> · ${p.active?"активен":"выключен"} · ${p.uses}/${p.max_uses||"∞"}</span><button data-toggle="${esc(p.code)}">${p.active?"Отключить":"Включить"}</button><button class="danger" data-remove="${esc(p.code)}">Удалить</button></div>`).join(""):"<p>Промокодов пока нет.</p>"}<button id="back" class="light">Назад</button>`;
  $("makePromo").onsubmit=async e=>{e.preventDefault();const code=$("promoCodeNew").value.trim().toUpperCase(),max_uses=Number($("promoLimitNew").value);
    if(!/^[A-Z0-9_-]{3,40}$/.test(code)){notify("Используй латиницу, цифры, дефис или подчёркивание.");return}
    const {error}=await sb.from("promo_codes").insert({code,max_uses,active:true});if(error)notify(error.message);else{notify("Промокод создан.");await managePromos()}
  };
  panel.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=async()=>{const p=promos.find(p=>p.code===b.dataset.toggle);const {error}=await sb.from("promo_codes").update({active:!p.active}).eq("code",p.code);if(error)notify(error.message);else await managePromos()});
  panel.querySelectorAll("[data-remove]").forEach(b=>b.onclick=async()=>{if(!confirm("Удалить промокод?"))return;const {error}=await sb.from("promo_codes").delete().eq("code",b.dataset.remove);if(error)notify(error.message);else await managePromos()});
  $("back").onclick=()=>{panel.classList.add("hidden");$("lesson").classList.remove("hidden");render()};
}
function setup(){
  $("login").addEventListener("submit",signIn);$("signup").addEventListener("click",signUp);
  $("logout").addEventListener("click",logout);$("newProgram").addEventListener("click",addProgram);
  $("manage").addEventListener("click",()=>managePromos().catch(e=>notify(e.message)));
  $("search").addEventListener("input",renderPrograms);
  sb.auth.getSession().then(({data,error})=>{if(error)msg(error.message);else if(data.session?.user)boot(data.session.user)});
  sb.auth.onAuthStateChange((_event,session)=>{if(session?.user&&!user)setTimeout(()=>boot(session.user),0)});
  // GitHub Pages is static; periodically re-fetch authorized course data for cross-device updates.
  setInterval(async()=>{
    if(!user)return;
    try{
      const fresh=await dataOrThrow(await sb.rpc("get_course_data"));
      if(JSON.stringify(fresh)!==JSON.stringify(course)){
        course=fresh||{programs:[]};
        if(!Array.isArray(course.programs))course.programs=[];
        if(!course.programs.some(p=>p.id===selected))selected=(course.programs.find(p=>canOpen(p))||course.programs[0])?.id||null;
        render();
      }
    }catch(e){console.warn("Фоновое обновление курса:",e.message)}
  },15000);
}
setup();
