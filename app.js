/* Supabase-backed Chemistry Trainer. Never put secret/service_role keys here. */
"use strict";
const SUPABASE_URL = "https://jjfuhqntmszksptaubeg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_qa1uohdpDbS9jp11DQi7gQ_b_OaceAK";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const uid = p => (p || "id") + "_" + crypto.randomUUID().slice(0,8);
let user=null, profile=null, fullAccess=false, course={programs:[]}, progress={}, selected=null, toastTimer;

function notify(s){
  $("toast").textContent=s;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$("toast").classList.remove("show"),3200);
}
function msg(s){$("authMsg").textContent=s}
function admin(){return profile?.role==="admin"}
function canOpen(p){return admin()||fullAccess||course.programs.findIndex(x=>x.id===p.id)===0}
async function dataOrThrow(r){if(r.error)throw r.error;return r.data}

async function signUp(){
  msg("");
  const email=$("email").value.trim(), password=$("password").value;
  if(password.length<8){
    msg("Пароль должен содержать не менее 8 символов.");
    return;
  }
  try{
    const {data,error}=await sb.auth.signUp({email,password});
    if(error)throw error;
    if(data.session) await boot(data.user);
    else msg("Аккаунт создан. Проверь почту, подтверди адрес и затем войди.");
  }catch(e){
    msg("Ошибка регистрации: "+e.message);
  }
}

async function signIn(e){
  e.preventDefault();
  msg("");
  try{
    const {data,error}=await sb.auth.signInWithPassword({
      email:$("email").value.trim(),
      password:$("password").value
    });
    if(error)throw error;
    await boot(data.user);
  }catch(e2){
    msg("Не удалось войти: "+e2.message);
  }
}

async function boot(u){
  user=u;
  try{
    profile=await dataOrThrow(
      await sb.from("profiles").select("id,email,role").eq("id",u.id).single()
    );
    const a=await dataOrThrow(
      await sb.from("user_access").select("full_access").eq("user_id",u.id).maybeSingle()
    );
    fullAccess=!!a?.full_access||admin();

    const c=await dataOrThrow(await sb.rpc("get_course_data"));
    course=c||{programs:[]};
    if(!Array.isArray(course.programs))course.programs=[];

    const pr=await dataOrThrow(
      await sb.from("user_progress").select("data").eq("user_id",u.id).maybeSingle()
    );
    progress=pr?.data||{};

    $("auth").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("badge").textContent=(u.email||"")+
      (admin()?" · АДМИНИСТРАТОР":fullAccess?" · ПОЛНЫЙ ДОСТУП":"");

    document.querySelectorAll(".admin").forEach(
      x=>x.classList.toggle("hidden",!admin())
    );

    if(!course.programs.some(p=>p.id===selected))
      selected=course.programs[0]?.id||null;

    render();
  }catch(e){
    msg("Ошибка загрузки. Проверь, что SQL выполнен полностью: "+e.message);
    console.error(e);
  }
}

async function logout(){
  await sb.auth.signOut();
  user=null;
  profile=null;
  fullAccess=false;
  progress={};
  $("app").classList.add("hidden");
  $("auth").classList.remove("hidden");
  $("badge").textContent="";
}

async function saveCourse(){
  if(!admin())throw Error("Редактировать курс может только администратор.");
  const {error}=await sb.from("course_state").upsert({
    id:1,
    data:course,
    updated_at:new Date().toISOString()
  });
  if(error)throw error;
}

async function saveProgress(){
  const {error}=await sb.from("user_progress").upsert({
    user_id:user.id,
    data:progress,
    updated_at:new Date().toISOString()
  });
  if(error)throw error;
}

async function changed(text){
  try{
    await saveCourse();
    render();
    notify(text);
  }catch(e){
    notify("Ошибка сохранения: "+e.message);
    console.error(e);
  }
}

function allQuestions(){
  return course.programs.flatMap(
    p=>(p.sections||[]).flatMap(s=>s.questions||[])
  );
}

function findSection(id){
  for(const p of course.programs){
    const s=(p.sections||[]).find(s=>s.id===id);
    if(s)return s;
  }
  return null;
}

function render(){
  renderPrograms();
  renderPromo();
  renderLesson();

  const done=course.programs.filter(
    p=>(p.sections||[]).length&&
    p.sections.every(
      s=>(s.questions||[]).length&&
      s.questions.every(q=>progress[q.id]?.correct)
    )
  ).length;

  $("progress").textContent=`Программ пройдено: ${done} / ${course.programs.length}`;
}

function renderPrograms(){
  const q=($("search").value||"").toLowerCase().trim();
  const list=course.programs.filter(
    p=>(p.title||"").toLowerCase().includes(q)
  );

  $("programs").innerHTML=list.length
    ?list.map(p=>`<button class="program ${p.id===selected?"active":""} ${canOpen(p)?"":"locked"}" data-p="${esc(p.id)}">${canOpen(p)?"📘":"🔒"} ${esc(p.title)}</button>`).join("")
    :`<div class="panel">${course.programs.length?"Ничего не найдено.":"Курс пока пуст."}</div>`;

  $("programs").querySelectorAll("[data-p]").forEach(b=>{
    b.onclick=()=>{
      const p=course.programs.find(x=>x.id===b.dataset.p);
      if(!canOpen(p)){
        notify("Эта программа закрыта. Нужен промокод.");
        return;
      }
      selected=p.id;
      $("adminPanel").classList.add("hidden");
      $("lesson").classList.remove("hidden");
      render();
    };
  });
}

function renderPromo(){
  if(admin()||fullAccess){
    $("promoBox").innerHTML="";
    return;
  }

  $("promoBox").innerHTML=`
    <div class="notice">
      <b>Бесплатно доступна первая программа.</b>
      <p>Есть промокод? Введи его ниже.</p>
      <form id="promoForm">
        <input id="promoInput" placeholder="Промокод" required>
        <button>Активировать</button>
      </form>
    </div>`;

  $("promoForm").onsubmit=async e=>{
    e.preventDefault();
    try{
      const {error}=await sb.rpc("redeem_course_promo",{
        p_code:$("promoInput").value.trim().toUpperCase()
      });
      if(error)throw error;

      fullAccess=true;
      course=await dataOrThrow(await sb.rpc("get_course_data"));
      if(!Array.isArray(course.programs))course.programs=[];

      $("badge").textContent=(user.email||"")+" · ПОЛНЫЙ ДОСТУП";
      render();
      notify("Полный доступ открыт!");
    }catch(err){
      notify(err.message||"Не удалось активировать промокод.");
    }
  };
}

function renderLesson(){
  const el=$("lesson");
  const p=course.programs.find(p=>p.id===selected);

  if(!p){
    el.innerHTML=`
      <div class="panel">
        <h2>Химический тренажёр</h2>
        <p>${admin()?"Создай первую программу кнопкой слева.":"Администратор ещё не добавил программы."}</p>
      </div>`;
    return;
  }

  if(!canOpen(p)){
    el.innerHTML='<div class="panel"><h2>Программа закрыта</h2><p>Для доступа нужен промокод.</p></div>';
    return;
  }

  const pi=course.programs.indexOf(p);

  el.innerHTML=`
    <div class="lesson-head">
      <small>ПРОГРАММА ${pi+1} ИЗ ${course.programs.length}</small>
      <h2>${esc(p.title)}</h2>
      <p>${esc(p.description||"")}</p>
    </div>

    ${(p.sections||[]).map((s,si)=>`
      <article class="section">
        <small>РАЗДЕЛ ${si+1}</small>
        <h3>${esc(s.title)}</h3>
        <div class="theory">${esc(s.text||"")}</div>

        ${(s.questions||[]).map((q,qi)=>{
          const r=progress[q.id];
          return `
            <div class="question" data-q="${esc(q.id)}">
              <b>${qi+1}. ${esc(q.text)}</b>
              <div class="options">
                ${(q.options||[]).map((o,oi)=>`
                  <button class="option ${r&&oi===q.answer?"good":r&&oi===r.selected?"bad":""}" data-a="${oi}" ${r?"disabled":""}>
                    ${esc(o)}
                  </button>
                `).join("")}
              </div>
              ${r?`
                <div class="feedback ${r.correct?"correct":"wrong"}">
                  <b>${r.correct?"Правильно!":"Неправильно."}</b>
                  ${esc(q.explanation||"")}
                  ${!r.correct?`<p>Правильный ответ: ${esc(q.options[q.answer]||"")}</p>`:""}
                </div>
              `:""}
            </div>`;
        }).join("")}

        ${admin()?`
          <div class="admin-actions">
            <button data-addq="${esc(s.id)}">+ Вопрос</button>
            <button data-edits="${esc(s.id)}">Изменить раздел</button>
            <button class="danger" data-dels="${esc(s.id)}">Удалить раздел</button>
          </div>
        `:""}
      </article>
    `).join("")}

    ${admin()?`
      <div class="panel">
        <h3>Управление программой</h3>
        <div class="admin-actions">
          <button id="addSection">+ Раздел</button>
          <button id="editProgram">Изменить программу</button>
          <button class="danger" id="deleteProgram">Удалить программу</button>
        </div>
      </div>
    `:""}
  `;

  el.querySelectorAll("[data-q]").forEach(qel=>{
    qel.querySelectorAll("[data-a]").forEach(b=>{
      b.onclick=async()=>{
        const q=allQuestions().find(x=>x.id===qel.dataset.q);
        if(!q||progress[q.id])return;

        const a=Number(b.dataset.a);
        progress[q.id]={
          selected:a,
          correct:a===Number(q.answer),
          date:new Date().toISOString()
        };

        try{
          await saveProgress();
          render();
        }catch(e){
          notify("Ошибка сохранения ответа: "+e.message);
        }
      };
    });
  });

  el.querySelectorAll("[data-addq]").forEach(
    b=>b.onclick=()=>addQuestion(b.dataset.addq)
  );
  el.querySelectorAll("[data-edits]").forEach(
    b=>b.onclick=()=>editSection(b.dataset.edits)
  );
  el.querySelectorAll("[data-dels]").forEach(
    b=>b.onclick=()=>deleteSection(b.dataset.dels)
  );

  $("addSection")?.addEventListener("click",addSection);
  $("editProgram")?.addEventListener("click",()=>editProgram(p.id));
  $("deleteProgram")?.addEventListener("click",()=>deleteProgram(p.id));
}

/* Встроенное окно редактора внутри сайта вместо prompt() */
function openEditor(title,fields,initial={}){
  return new Promise(resolve=>{
    const backdrop=$("editorBackdrop");
    const form=$("editorForm");
    const fieldsEl=$("editorFields");

    $("editorTitle").textContent=title;
    fieldsEl.innerHTML="";

    fields.forEach(f=>{
      const value=initial[f.name]??f.value??"";
      const label=document.createElement("label");

      label.innerHTML=esc(f.label)+(f.required?' <span aria-hidden="true">*</span>':"");

      let input;
      if(f.type==="textarea"){
        input=document.createElement("textarea");
        input.rows=f.rows||5;
        input.value=value;
        if(f.compact)input.className="compact-textarea";
      }else{
        input=document.createElement("input");
        input.type=f.type||"text";
        input.value=value;
        if(f.min!==undefined)input.min=f.min;
        if(f.maxlength)input.maxLength=f.maxlength;
      }

      input.id="editor_"+f.name;
      input.name=f.name;
      input.required=!!f.required;
      if(f.placeholder)input.placeholder=f.placeholder;

      label.appendChild(input);

      if(f.help){
        const help=document.createElement("span");
        help.className="field-help";
        help.textContent=f.help;
        label.appendChild(help);
      }

      fieldsEl.appendChild(label);
    });

    backdrop.classList.remove("hidden");
    const first=fieldsEl.querySelector("input,textarea");
    if(first)first.focus();

    let finished=false;

    const cleanup=value=>{
      if(finished)return;
      finished=true;
      backdrop.classList.add("hidden");
      form.removeEventListener("submit",submit);
      $("editorClose").removeEventListener("click",cancel);
      $("editorCancel").removeEventListener("click",cancel);
      backdrop.removeEventListener("click",outside);
      document.removeEventListener("keydown",escape);
      resolve(value);
    };

    const cancel=()=>cleanup(null);
    const outside=e=>{
      if(e.target===backdrop)cancel();
    };
    const escape=e=>{
      if(e.key==="Escape")cancel();
    };
    const submit=e=>{
      e.preventDefault();
      if(!form.reportValidity())return;

      const values={};
      fields.forEach(f=>{
        values[f.name]=$("editor_"+f.name).value;
      });
      cleanup(values);
    };

    form.addEventListener("submit",submit);
    $("editorClose").addEventListener("click",cancel);
    $("editorCancel").addEventListener("click",cancel);
    backdrop.addEventListener("click",outside);
    document.addEventListener("keydown",escape);
  });
}

async function addProgram(){
  if(!admin())return;

  const v=await openEditor("Добавить программу",[
    {
      name:"title",
      label:"Название программы",
      required:true,
      placeholder:"Например, Основы химии"
    },
    {
      name:"description",
      label:"Краткое описание",
      type:"textarea",
      rows:3,
      placeholder:"Для чего эта программа и что изучит ученик"
    }
  ]);

  if(!v||!v.title.trim())return;

  const p={
    id:uid("program"),
    title:v.title.trim(),
    description:v.description.trim(),
    sections:[]
  };

  course.programs.push(p);
  selected=p.id;
  await changed("Программа создана.");
}

async function editProgram(id){
  const p=course.programs.find(x=>x.id===id);
  if(!admin()||!p)return;

  const v=await openEditor("Изменить программу",[
    {name:"title",label:"Название программы",required:true},
    {name:"description",label:"Краткое описание",type:"textarea",rows:3}
  ],p);

  if(!v||!v.title.trim())return;

  p.title=v.title.trim();
  p.description=v.description.trim();
  await changed("Программа обновлена.");
}

async function deleteProgram(id){
  const p=course.programs.find(x=>x.id===id);

  if(!admin()||!p||!confirm(
    `Удалить программу «${p.title}» вместе со всеми рубриками и вопросами? Это действие нельзя отменить.`
  ))return;

  (p.sections||[]).flatMap(s=>s.questions||[]).forEach(
    q=>delete progress[q.id]
  );

  course.programs=course.programs.filter(x=>x.id!==id);
  selected=course.programs[0]?.id||null;

  try{
    await saveCourse();
    await saveProgress();
    render();
    notify("Программа удалена.");
  }catch(e){
    notify(e.message);
  }
}

async function addSection(){
  const p=course.programs.find(p=>p.id===selected);
  if(!admin()||!p)return;

  const v=await openEditor("Добавить рубрику",[
    {
      name:"title",
      label:"Название рубрики",
      required:true,
      placeholder:"Например, Строение вещества"
    },
    {
      name:"text",
      label:"Учебный текст / теория",
      type:"textarea",
      rows:9,
      help:"Можно вставить большой фрагмент текста. Переносы строк сохранятся."
    }
  ]);

  if(!v||!v.title.trim())return;

  p.sections||=[];
  p.sections.push({
    id:uid("section"),
    title:v.title.trim(),
    text:v.text,
    questions:[]
  });

  await changed("Рубрика добавлена.");
}

async function editSection(id){
  const s=findSection(id);
  if(!admin()||!s)return;

  const v=await openEditor("Изменить рубрику",[
    {name:"title",label:"Название рубрики",required:true},
    {
      name:"text",
      label:"Учебный текст / теория",
      type:"textarea",
      rows:12,
      help:"Переносы строк сохраняются."
    }
  ],s);

  if(!v||!v.title.trim())return;

  s.title=v.title.trim();
  s.text=v.text;
  await changed("Рубрика изменена.");
}

async function deleteSection(id){
  const p=course.programs.find(
    p=>(p.sections||[]).some(s=>s.id===id)
  );
  const s=findSection(id);

  if(!admin()||!p||!s||!confirm(
    `Удалить рубрику «${s.title}» и все её вопросы? Это действие нельзя отменить.`
  ))return;

  (s.questions||[]).forEach(q=>delete progress[q.id]);
  p.sections=p.sections.filter(x=>x.id!==id);

  try{
    await saveCourse();
    await saveProgress();
    render();
    notify("Рубрика удалена.");
  }catch(e){
    notify(e.message);
  }
}

async function addQuestion(id){
  const s=findSection(id);
  if(!admin()||!s)return;

  const v=await openEditor("Добавить вопрос или задание",[
    {
      name:"text",
      label:"Текст вопроса / задания",
      type:"textarea",
      rows:4,
      required:true,
      help:"Например: Какова формула воды? Можно добавить условие задачи."
    },
    {
      name:"options",
      label:"Варианты ответа — по одному на строку",
      type:"textarea",
      rows:5,
      required:true,
      value:"Вариант 1\nВариант 2\nВариант 3",
      help:"Сейчас поддерживаются задания с выбором одного правильного ответа."
    },
    {
      name:"answer",
      label:"Номер правильного варианта",
      type:"number",
      min:1,
      required:true,
      value:"1",
      help:"Нумерация начинается с 1 — как варианты сверху."
    },
    {
      name:"explanation",
      label:"Объяснение ответа",
      type:"textarea",
      rows:4,
      help:"Показывается после ответа ученика."
    }
  ]);

  if(!v||!v.text.trim())return;

  const options=v.options.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);

  if(options.length<2){
    notify("Добавь минимум два варианта ответа — каждый с новой строки.");
    return;
  }

  const n=Number(v.answer)-1;

  if(!Number.isInteger(n)||n<0||n>=options.length){
    notify(`Номер ответа должен быть от 1 до ${options.length}.`);
    return;
  }

  s.questions||=[];
  s.questions.push({
    id:uid("question"),
    text:v.text.trim(),
    options,
    answer:n,
    explanation:v.explanation.trim()
  });

  await changed("Вопрос добавлен.");
}

async function managePromos(){
  if(!admin())return;

  const panel=$("adminPanel");
  panel.classList.remove("hidden");
  $("lesson").classList.add("hidden");

  const promos=await dataOrThrow(
    await sb.from("promo_codes").select("*").order("created_at",{ascending:false})
  );

  panel.innerHTML=`
    <h2>Промокоды</h2>
    <form id="makePromo">
      <label>Код
        <input id="promoCodeNew" required maxlength="40" placeholder="CHEM2026">
      </label>
      <label>Лимит (0 — без лимита)
        <input id="promoLimitNew" type="number" min="0" value="1" required>
      </label>
      <button>Создать промокод</button>
    </form>
    <h3>Список</h3>
    ${
      promos.length
      ?promos.map(p=>`
        <div class="admin-row">
          <span>
            <b>${esc(p.code)}</b> · ${p.active?"активен":"выключен"} ·
            ${p.uses}/${p.max_uses||"∞"}
          </span>
          <button data-toggle="${esc(p.code)}">${p.active?"Отключить":"Включить"}</button>
          <button class="danger" data-remove="${esc(p.code)}">Удалить</button>
        </div>
      `).join("")
      :"<p>Промокодов пока нет.</p>"
    }
    <button id="back" class="light">Назад</button>
  `;

  $("makePromo").onsubmit=async e=>{
    e.preventDefault();

    const code=$("promoCodeNew").value.trim().toUpperCase();
    const max_uses=Number($("promoLimitNew").value);

    if(!/^[A-Z0-9_-]{3,40}$/.test(code)){
      notify("Используй латиницу, цифры, дефис или подчёркивание.");
      return;
    }

    const {error}=await sb.from("promo_codes").insert({
      code,
      max_uses,
      active:true
    });

    if(error)notify(error.message);
    else{
      notify("Промокод создан.");
      await managePromos();
    }
  };

  panel.querySelectorAll("[data-toggle]").forEach(b=>{
    b.onclick=async()=>{
      const p=promos.find(p=>p.code===b.dataset.toggle);
      const {error}=await sb.from("promo_codes")
        .update({active:!p.active})
        .eq("code",p.code);

      if(error)notify(error.message);
      else await managePromos();
    };
  });

  panel.querySelectorAll("[data-remove]").forEach(b=>{
    b.onclick=async()=>{
      if(!confirm("Удалить промокод?"))return;

      const {error}=await sb.from("promo_codes")
        .delete()
        .eq("code",b.dataset.remove);

      if(error)notify(error.message);
      else await managePromos();
    };
  });

  $("back").onclick=()=>{
    panel.classList.add("hidden");
    $("lesson").classList.remove("hidden");
    render();
  };
}

function setup(){
  $("login").addEventListener("submit",signIn);
  $("signup").addEventListener("click",signUp);
  $("logout").addEventListener("click",logout);
  $("newProgram").addEventListener("click",addProgram);
  $("manage").addEventListener("click",()=>managePromos().catch(e=>notify(e.message)));
  $("search").addEventListener("input",renderPrograms);

  sb.auth.getSession().then(({data,error})=>{
    if(error)msg(error.message);
    else if(data.session?.user)boot(data.session.user);
  });

  sb.auth.onAuthStateChange((_event,session)=>{
    if(session?.user&&!user)setTimeout(()=>boot(session.user),0);
  });

  // Периодическое обновление данных курса.
  setInterval(async()=>{
    if(!user)return;

    try{
      const fresh=await dataOrThrow(await sb.rpc("get_course_data"));

      if(JSON.stringify(fresh)!==JSON.stringify(course)){
        course=fresh||{programs:[]};
        if(!Array.isArray(course.programs))course.programs=[];
        if(!course.programs.some(p=>p.id===selected))
          selected=course.programs[0]?.id||null;
        render();
      }
    }catch(e){
      console.warn("Фоновое обновление курса:",e.message);
    }
  },15000);
}

setup();