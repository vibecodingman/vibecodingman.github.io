
"use strict";

// ======================================================
// НАСТРОЙКИ
// ======================================================

// Поменяй ключ на собственный.
// Важно: для настоящего сайта с платным доступом нужна серверная авторизация.
const ADMIN_KEY = "ADMINPSSW";
const STORAGE_KEY = "nentwig-chemistry-course-v1";

const $ = (id) => document.getElementById(id);

const uid = (prefix = "id") =>
  prefix + "_" + Math.random().toString(36).slice(2, 10);

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

// ======================================================
// 1. ПУСТОЙ КУРС
// Никакие программы и уроки автоматически не создаются.
// ======================================================

function emptyDatabase() {
  return {
    programs: [],
    users: {},
    promos: {},
    results: {}
  };
}

function loadDatabase() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return emptyDatabase();

    const data = JSON.parse(saved);

    if (!data || !Array.isArray(data.programs)) {
      return emptyDatabase();
    }

    data.users ||= {};
    data.promos ||= {};
    data.results ||= {};

    return data;
  } catch (error) {
    console.error("Ошибка загрузки данных:", error);
    return emptyDatabase();
  }
}

let db = loadDatabase();
let currentUser = null;
let selectedProgramId = null;
let toastTimer = null;

function saveDatabase() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    console.error(error);
    notify("Не удалось сохранить данные. Сделай резервную копию.");
  }
}

// ======================================================
// 2. ОБЩИЕ ФУНКЦИИ
// ======================================================

function notify(message) {
  const toast = $("toast");

  if (!toast) {
    alert(message);
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function isAdmin() {
  return currentUser?.role === "admin";
}

function hasFullAccess() {
  return isAdmin() || Boolean(currentUser?.fullAccess);
}

function getResults() {
  if (!currentUser) return {};
  db.results[currentUser.id] ||= {};
  return db.results[currentUser.id];
}

function allQuestions() {
  return db.programs.flatMap(program =>
    (program.sections || []).flatMap(section =>
      section.questions || []
    )
  );
}

function findProgram(programId) {
  return db.programs.find(program => program.id === programId);
}

function canOpenProgram(programId) {
  const index = db.programs.findIndex(program => program.id === programId);
  return index === 0 || hasFullAccess();
}

// ======================================================
// 3. ВХОД И ВЫХОД
// ======================================================

function loginStudent(event) {
  event.preventDefault();

  const name = $("name")?.value.trim();
  const id = $("uid")?.value.trim();

  if (!name || !id) {
    showAuthMessage("Введи имя и ID.");
    return;
  }

  let user = db.users[id];

  if (!user) {
    user = {
      id,
      name,
      role: "student",
      fullAccess: false,
      createdAt: new Date().toISOString()
    };

    db.users[id] = user;
    db.results[id] = {};
  } else {
    user.name = name;
  }

  saveDatabase();
  enter(user);
}

function loginAdmin(event) {
  event.preventDefault();

  const name = $("adminName")?.value.trim() || "Администратор";
  const id = $("adminId")?.value.trim() || "admin";
  const key = $("adminKey")?.value || "";

  if (key !== ADMIN_KEY) {
    showAuthMessage("Неверный ключ администратора.");
    return;
  }

  enter({
    id,
    name,
    role: "admin",
    fullAccess: true
  });
}

function showAuthMessage(message) {
  const element = $("authMsg");
  if (element) element.textContent = message;
  else notify(message);
}

function enter(user) {
  currentUser = user;

  if (!selectedProgramId) {
    selectedProgramId = db.programs[0]?.id || null;
  }

  $("auth")?.classList.add("hidden");
  $("app")?.classList.remove("hidden");

  const badge = $("badge");
  if (badge) {
    badge.textContent =
      `${user.name} · ID ${user.id}` +
      (isAdmin() ? " · АДМИНИСТРАТОР" :
        hasFullAccess() ? " · ПОЛНЫЙ ДОСТУП" : "");
  }

  document.querySelectorAll(".admin").forEach(element => {
    element.classList.toggle("hidden", !isAdmin());
  });

  render();
}

function logout() {
  currentUser = null;

  $("app")?.classList.add("hidden");
  $("auth")?.classList.remove("hidden");

  if ($("authMsg")) $("authMsg").textContent = "";
}

function bindLogin() {
  $("login")?.addEventListener("submit", loginStudent);
  $("adminLogin")?.addEventListener("submit", loginAdmin);
  $("logout")?.addEventListener("click", logout);
}

// ======================================================
// 4. СПИСОК ПРОГРАММ
// ======================================================

function renderProgramList() {
  const container = $("programs");
  if (!container) return;

  const query = ($("search")?.value || "").trim().toLowerCase();

  const visiblePrograms = db.programs.filter(program =>
    program.title.toLowerCase().includes(query)
  );

  if (!visiblePrograms.length) {
    container.innerHTML = `
      <div class="panel">
        <p>${db.programs.length
          ? "Ничего не найдено."
          : "Курс пока пуст."}</p>
        ${isAdmin()
          ? '<button type="button" id="emptyAddProgram">+ Создать первую программу</button>'
          : '<p>Администратор ещё не добавил программы.</p>'}
      </div>
    `;

    $("emptyAddProgram")?.addEventListener("click", createProgram);
    return;
  }

  container.innerHTML = visiblePrograms.map(program => {
    const unlocked = canOpenProgram(program.id);

    return `
      <button
        type="button"
        class="program ${
          program.id === selectedProgramId ? "active" : ""
        } ${unlocked ? "" : "locked"}"
        data-open-program="${esc(program.id)}"
      >
        ${unlocked ? "📘" : "🔒"} ${esc(program.title)}
      </button>
    `;
  }).join("");

  container.querySelectorAll("[data-open-program]").forEach(button => {
    button.addEventListener("click", () => {
      const id = button.dataset.openProgram;

      if (!canOpenProgram(id)) {
        notify("Эта программа закрыта. Нужен промокод.");
        return;
      }

      selectedProgramId = id;
      $("adminPanel")?.classList.add("hidden");
      $("lesson")?.classList.remove("hidden");
      render();
    });
  });
}

// ======================================================
// 5. ПРОМОКОДЫ И ДОСТУП
// ======================================================

function renderPromoBox() {
  const box = $("promoBox");
  if (!box) return;

  if (hasFullAccess()) {
    box.innerHTML = "";
    return;
  }

  box.innerHTML = `
    <div class="notice">
      <b>Бесплатно доступна первая программа.</b>
      <p>Есть промокод? Введи его ниже.</p>
      <form id="promoForm">
        <input id="promoInput" placeholder="Промокод" required>
        <button type="submit">Активировать</button>
      </form>
    </div>
  `;

  $("promoForm")?.addEventListener("submit", event => {
    event.preventDefault();

    const code = $("promoInput").value.trim().toUpperCase();
    const promo = db.promos[code];

    if (!promo || !promo.active) {
      notify("Промокод не найден или отключён.");
      return;
    }

    promo.used ||= [];

    if (promo.used.includes(currentUser.id)) {
      notify("Ты уже использовал этот промокод.");
      return;
    }

    if (promo.limit > 0 && promo.uses >= promo.limit) {
      notify("Лимит активаций исчерпан.");
      return;
    }

    promo.uses++;
    promo.used.push(currentUser.id);

    currentUser.fullAccess = true;

    if (db.users[currentUser.id]) {
      db.users[currentUser.id].fullAccess = true;
    }

    saveDatabase();
    enter(currentUser);
    notify("Полный доступ открыт!");
  });
}

// ======================================================
// 6. ОТОБРАЖЕНИЕ УРОКА
// ======================================================

function renderLesson() {
  const container = $("lesson");
  if (!container) return;

  const program = findProgram(selectedProgramId);

  if (!program) {
    container.innerHTML = `
      <div class="panel">
        <h2>Добро пожаловать в химический тренажёр</h2>
        <p>Здесь пока нет учебных программ.</p>
        ${isAdmin()
          ? '<button type="button" id="lessonAddProgram">+ Создать программу</button>'
          : '<p>Загляни позже — администратор добавит материалы.</p>'}
      </div>
    `;

    $("lessonAddProgram")?.addEventListener("click", createProgram);
    return;
  }

  if (!canOpenProgram(program.id)) {
    container.innerHTML = `
      <div class="panel">
        <h2>Программа закрыта</h2>
        <p>Для доступа нужен промокод.</p>
      </div>
    `;
    return;
  }

  const results = getResults();
  const programIndex = db.programs.findIndex(p => p.id === program.id);

  container.innerHTML = `
    <div class="lesson-head">
      <small>ПРОГРАММА ${programIndex + 1} ИЗ ${db.programs.length}</small>
      <h2>${esc(program.title)}</h2>
      <p>${esc(program.description || "")}</p>
    </div>

    ${(program.sections || []).map((section, sectionIndex) => `
      <article class="section">
        <small>РАЗДЕЛ ${sectionIndex + 1}</small>
        <h3>${esc(section.title || "Без названия")}</h3>
        <div class="theory">${esc(section.text || "")}</div>

        ${(section.questions || []).map((question, questionIndex) => {
          const result = results[question.id];

          return `
            <div class="question" data-question="${esc(question.id)}">
              <b>${questionIndex + 1}. ${esc(question.text)}</b>

              <div class="options">
                ${(question.options || []).map((option, optionIndex) => {
                  let cls = "option";

                  if (result && optionIndex === question.answer) {
                    cls += " good";
                  } else if (result && optionIndex === result.selected) {
                    cls += " bad";
                  }

                  return `
                    <button
                      type="button"
                      class="${cls}"
                      data-answer="${optionIndex}"
                      ${result ? "disabled" : ""}
                    >
                      ${esc(option)}
                    </button>
                  `;
                }).join("")}
              </div>

              ${result ? `
                <div class="feedback ${result.correct ? "correct" : "wrong"}">
                  <b>${result.correct ? "Правильно!" : "Неправильно."}</b>
                  ${esc(question.explanation || "")}
                  ${!result.correct ? `
                    <p>Правильный ответ: ${esc(question.options[question.answer])}</p>
                  ` : ""}
                </div>
              ` : ""}
            </div>
          `;
        }).join("")}

        ${isAdmin() ? `
          <div class="admin-actions">
            <button type="button" data-add-question="${esc(section.id)}">
              + Добавить вопрос
            </button>
            <button type="button" data-edit-section="${esc(section.id)}">
              Изменить раздел
            </button>
            <button type="button" class="danger" data-delete-section="${esc(section.id)}">
              Удалить раздел
            </button>
          </div>
        ` : ""}
      </article>
    `).join("")}

    ${!program.sections?.length
      ? "<p>В этой программе пока нет разделов.</p>"
      : ""}

    ${isAdmin() ? `
      <div class="panel admin">
        <h3>Управление программой</h3>
        <div class="admin-actions">
          <button type="button" id="addSection">+ Добавить раздел</button>
          <button type="button" id="editCurrentProgram">Изменить программу</button>
          <button type="button" class="danger" id="deleteCurrentProgram">Удалить программу</button>
        </div>
      </div>
    ` : ""}
  `;

  container.querySelectorAll("[data-question]").forEach(questionElement => {
    questionElement.querySelectorAll("[data-answer]").forEach(button => {
      button.addEventListener("click", () => {
        const question = allQuestions().find(
          q => q.id === questionElement.dataset.question
        );

        if (!question || results[question.id]) return;

        const selected = Number(button.dataset.answer);

        results[question.id] = {
          selected,
          correct: selected === Number(question.answer),
          date: new Date().toISOString()
        };

        db.results[currentUser.id] = results;
        saveDatabase();
        render();
      });
    });
  });

  container.querySelectorAll("[data-add-question]").forEach(button => {
    button.addEventListener("click", () =>
      createQuestion(button.dataset.addQuestion)
    );
  });

  container.querySelectorAll("[data-edit-section]").forEach(button => {
    button.addEventListener("click", () =>
      editSection(button.dataset.editSection)
    );
  });

  container.querySelectorAll("[data-delete-section]").forEach(button => {
    button.addEventListener("click", () =>
      deleteSection(button.dataset.deleteSection)
    );
  });

  $("addSection")?.addEventListener("click", createSection);
  $("editCurrentProgram")?.addEventListener("click", () =>
    editProgram(program.id)
  );
  $("deleteCurrentProgram")?.addEventListener("click", () =>
    deleteProgram(program.id)
  );
}

// ======================================================
// 7. СОЗДАНИЕ И РЕДАКТИРОВАНИЕ ПРОГРАММ
// ======================================================

function createProgram() {
  if (!isAdmin()) return;

  const title = prompt("Название программы:");
  if (!title?.trim()) return;

  const description = prompt("Описание программы:") || "";

  const program = {
    id: uid("program"),
    title: title.trim(),
    description: description.trim(),
    sections: []
  };

  db.programs.push(program);
  selectedProgramId = program.id;

  saveDatabase();
  render();
  notify("Программа создана. Теперь добавь разделы.");
}

function editProgram(programId) {
  if (!isAdmin()) return;

  const program = findProgram(programId);
  if (!program) return;

  const title = prompt("Название программы:", program.title);
  if (title === null || !title.trim()) return;

  const description = prompt("Описание:", program.description || "");
  if (description === null) return;

  program.title = title.trim();
  program.description = description.trim();

  saveDatabase();
  render();
  notify("Программа обновлена.");
}

function deleteProgram(programId) {
  if (!isAdmin()) return;

  const program = findProgram(programId);
  if (!program) return;

  if (!confirm(`Удалить программу «${program.title}» и все её материалы?`)) {
    return;
  }

  const questionIds = (program.sections || [])
    .flatMap(section => section.questions || [])
    .map(question => question.id);

  db.programs = db.programs.filter(p => p.id !== programId);

  Object.values(db.results).forEach(userResults => {
    questionIds.forEach(id => delete userResults[id]);
  });

  selectedProgramId = db.programs[0]?.id || null;

  saveDatabase();
  render();
  notify("Программа удалена.");
}

// ======================================================
// 8. СОЗДАНИЕ И РЕДАКТИРОВАНИЕ РАЗДЕЛОВ
// ======================================================

function createSection() {
  if (!isAdmin()) return;

  const program = findProgram(selectedProgramId);
  if (!program) {
    notify("Сначала создай программу.");
    return;
  }

  const title = prompt("Название раздела:");
  if (!title?.trim()) return;

  const text = prompt("Текст теории для раздела:") || "";

  program.sections.push({
    id: uid("section"),
    title: title.trim(),
    text: text.trim(),
    questions: []
  });

  saveDatabase();
  render();
  notify("Раздел создан.");
}

function editSection(sectionId) {
  if (!isAdmin()) return;

  const program = findProgram(selectedProgramId);
  const section = program?.sections.find(s => s.id === sectionId);
  if (!section) return;

  const title = prompt("Название раздела:", section.title);
  if (title === null || !title.trim()) return;

  const text = prompt("Текст теории:", section.text || "");
  if (text === null) return;

  section.title = title.trim();
  section.text = text.trim();

  saveDatabase();
  render();
  notify("Раздел обновлён.");
}

function deleteSection(sectionId) {
  if (!isAdmin()) return;

  const program = findProgram(selectedProgramId);
  const section = program?.sections.find(s => s.id === sectionId);
  if (!section) return;

  if (!confirm(`Удалить раздел «${section.title}» и все его вопросы?`)) {
    return;
  }

  const questionIds = (section.questions || []).map(q => q.id);

  program.sections = program.sections.filter(s => s.id !== sectionId);

  Object.values(db.results).forEach(userResults => {
    questionIds.forEach(id => delete userResults[id]);
  });

  saveDatabase();
  render();
  notify("Раздел удалён.");
}

// ======================================================
// 9. СОЗДАНИЕ ВОПРОСОВ
// ======================================================

function createQuestion(sectionId) {
  if (!isAdmin()) return;

  const program = findProgram(selectedProgramId);
  const section = program?.sections.find(s => s.id === sectionId);
  if (!section) return;

  const text = prompt("Текст вопроса:");
  if (!text?.trim()) return;

  const optionsText = prompt(
    "Варианты ответов через символ |",
    "Вариант 1 | Вариант 2 | Вариант 3 | Вариант 4"
  );

  if (!optionsText) return;

  const options = optionsText.split("|").map(option => option.trim());

  if (options.length < 2 || options.some(option => !option)) {
    notify("Добавь минимум два непустых варианта ответа.");
    return;
  }

  const answerText = prompt(
    `Номер правильного варианта (от 1 до ${options.length}):`,
    "1"
  );

  if (answerText === null) return;

  const answer = Number(answerText) - 1;

  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
    notify("Неверный номер правильного ответа.");
    return;
  }

  const explanation = prompt("Объяснение ответа:") || "";

  section.questions.push({
    id: uid("question"),
    text: text.trim(),
    options,
    answer,
    explanation: explanation.trim()
  });

  saveDatabase();
  render();
  notify("Вопрос добавлен.");
}

// ======================================================
// 10. ПАНЕЛЬ АДМИНИСТРАТОРА
// ======================================================

function renderAdminPanel() {
  const panel = $("adminPanel");
  if (!panel || !isAdmin()) return;

  panel.classList.remove("hidden");

  panel.innerHTML = `
    <div class="panel admin">
      <h2>Редактор курса</h2>
      <p>Создавай программы, разделы и задания. Все поля изначально пустые.</p>

      <div class="admin-actions">
        <button type="button" id="adminCreateProgram">+ Новая программа</button>
        <button type="button" id="adminPromos">Промокоды</button>
        <button type="button" id="adminUsers">Ученики</button>
        <button type="button" id="adminBackup">Резервная копия</button>
      </div>

      <div id="adminContent"></div>
    </div>
  `;

  $("adminCreateProgram")?.addEventListener("click", createProgram);
  $("adminPromos")?.addEventListener("click", renderPromosAdmin);
  $("adminUsers")?.addEventListener("click", renderUsersAdmin);
  $("adminBackup")?.addEventListener("click", renderBackupAdmin);

  const content = $("adminContent");

  content.innerHTML = `
    <h3>Твои программы (${db.programs.length})</h3>
    ${db.programs.length ? db.programs.map((program, index) => `
      <div class="admin-row">
        <div>
          <b>${index + 1}. ${esc(program.title)}</b>
          <p>${esc(program.description || "Описание не добавлено")}</p>
          <small>Разделов: ${(program.sections || []).length}</small>
        </div>
        <div class="admin-actions">
          <button type="button" data-select="${esc(program.id)}">Открыть</button>
          <button type="button" data-edit="${esc(program.id)}">Изменить</button>
          <button type="button" class="danger" data-remove="${esc(program.id)}">Удалить</button>
        </div>
      </div>
    `).join("") : `
      <div class="notice">
        <h3>Курс пока пуст</h3>
        <p>Нажми «Новая программа», чтобы начать наполнять учебник.</p>
      </div>
    `}
  `;

  content.querySelectorAll("[data-select]").forEach(button => {
    button.addEventListener("click", () => {
      selectedProgramId = button.dataset.select;
      $("adminPanel")?.classList.add("hidden");
      $("lesson")?.classList.remove("hidden");
      render();
    });
  });

  content.querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => editProgram(button.dataset.edit));
  });

  content.querySelectorAll("[data-remove]").forEach(button => {
    button.addEventListener("click", () => deleteProgram(button.dataset.remove));
  });
}

function renderPromosAdmin() {
  const content = $("adminContent");
  if (!content || !isAdmin()) return;

  content.innerHTML = `
    <h3>Создать промокод</h3>
    <form id="promoCreateForm">
      <label>Название промокода
        <input id="newPromoCode" placeholder="Например, CHEM2026" required>
      </label>
      <label>Лимит активаций (0 — без лимита)
        <input id="newPromoLimit" type="number" min="0" value="0" required>
      </label>
      <button type="submit">Создать</button>
    </form>

    <h3>Существующие промокоды</h3>
    ${Object.entries(db.promos).map(([code, promo]) => `
      <div class="admin-row">
        <div>
          <b>${esc(code)}</b>
          <p>Использований: ${promo.uses || 0}
            ${promo.limit > 0 ? "/ " + promo.limit : "/ без лимита"}</p>
          <small>${promo.active ? "Активен" : "Отключён"}</small>
        </div>
        <div class="admin-actions">
          <button type="button" data-toggle-promo="${esc(code)}">
            ${promo.active ? "Отключить" : "Включить"}
          </button>
          <button type="button" class="danger" data-delete-promo="${esc(code)}">Удалить</button>
        </div>
      </div>
    `).join("") || "<p>Промокодов пока нет.</p>"}
  `;

  $("promoCreateForm")?.addEventListener("submit", event => {
    event.preventDefault();

    const code = $("newPromoCode").value.trim().toUpperCase();
    const limit = Number($("newPromoLimit").value);

    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      notify("Используй 3–40 латинских букв, цифр, - или _.");
      return;
    }

    if (db.promos[code]) {
      notify("Такой промокод уже существует.");
      return;
    }

    db.promos[code] = {
      active: true,
      limit: Math.max(0, limit || 0),
      uses: 0,
      used: []
    };

    saveDatabase();
    renderPromosAdmin();
    notify("Промокод создан: " + code);
  });

  content.querySelectorAll("[data-toggle-promo]").forEach(button => {
    button.addEventListener("click", () => {
      const promo = db.promos[button.dataset.togglePromo];
      if (!promo) return;

      promo.active = !promo.active;
      saveDatabase();
      renderPromosAdmin();
    });
  });

  content.querySelectorAll("[data-delete-promo]").forEach(button => {
    button.addEventListener("click", () => {
      const code = button.dataset.deletePromo;
      if (!confirm(`Удалить промокод ${code}?`)) return;

      delete db.promos[code];
      saveDatabase();
      renderPromosAdmin();
    });
  });
}

function renderUsersAdmin() {
  const content = $("adminContent");
  if (!content || !isAdmin()) return;

  const users = Object.values(db.users);

  content.innerHTML = `
    <h3>Ученики (${users.length})</h3>
    ${users.map(user => `
      <div class="admin-row">
        <div>
          <b>${esc(user.name)}</b>
          <p>ID: ${esc(user.id)}</p>
          <small>${user.fullAccess ? "Полный доступ" : "Бесплатный доступ"}</small>
        </div>
        <button type="button" data-access="${esc(user.id)}">
          ${user.fullAccess ? "Закрыть доступ" : "Открыть весь курс"}
        </button>
      </div>
    `).join("") || "<p>Ученики пока не зарегистрированы.</p>"}
  `;

  content.querySelectorAll("[data-access]").forEach(button => {
    button.addEventListener("click", () => {
      const user = db.users[button.dataset.access];
      if (!user) return;

      user.fullAccess = !user.fullAccess;
      saveDatabase();
      renderUsersAdmin();
    });
  });
}

function renderBackupAdmin() {
  const content = $("adminContent");
  if (!content || !isAdmin()) return;

  content.innerHTML = `
    <h3>Резервная копия</h3>
    <p>Скачай файл, чтобы сохранить все программы, разделы, вопросы и промокоды.</p>
    <button type="button" id="downloadBackup">Скачать JSON</button>

    <hr>

    <p>Импорт заменит текущие данные. Перед импортом рекомендуется скачать копию.</p>
    <input type="file" id="backupFile" accept=".json,application/json">
    <button type="button" id="uploadBackup">Импортировать JSON</button>
  `;

  $("downloadBackup")?.addEventListener("click", exportBackup);
  $("uploadBackup")?.addEventListener("click", importBackup);
}

// ======================================================
// 11. РЕЗЕРВНОЕ КОПИРОВАНИЕ
// ======================================================

function exportBackup() {
  const blob = new Blob(
    [JSON.stringify(db, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "chemistry-course-backup.json";
  link.click();

  URL.revokeObjectURL(url);
  notify("Резервная копия скачана.");
}

function importBackup() {
  const file = $("backupFile")?.files?.[0];

  if (!file) {
    notify("Сначала выбери JSON-файл.");
    return;
  }

  if (!confirm("Импорт заменит текущие данные. Продолжить?")) return;

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      if (!data || !Array.isArray(data.programs)) {
        throw new Error("Неправильный формат файла");
      }

      data.users ||= {};
      data.promos ||= {};
      data.results ||= {};

      db = data;
      selectedProgramId = db.programs[0]?.id || null;

      saveDatabase();
      render();
      renderAdminPanel();

      notify("Резервная копия импортирована.");
    } catch (error) {
      console.error(error);
      notify("Не удалось прочитать файл. Проверь JSON.");
    }
  };

  reader.readAsText(file);
}

// ======================================================
// 12. ПРОГРЕСС И ОБНОВЛЕНИЕ ИНТЕРФЕЙСА
// ======================================================

function renderProgress() {
  const element = $("progress");
  if (!element || !currentUser) return;

  const results = getResults();

  const completed = db.programs.filter(program => {
    const questions = (program.sections || [])
      .flatMap(section => section.questions || []);

    return questions.length > 0 &&
      questions.every(question => results[question.id]?.correct);
  }).length;

  element.textContent =
    `Программ пройдено: ${completed} / ${db.programs.length}`;
}

function render() {
  if (!currentUser) return;

  renderProgramList();
  renderPromoBox();
  renderProgress();
  renderLesson();

  if (isAdmin()) {
    // Панель показывается только когда пользователь открыл управление.
    if (!$("adminPanel")?.classList.contains("hidden")) {
      renderAdminPanel();
    }
  } else {
    $("adminPanel")?.classList.add("hidden");
  }
}

// ======================================================
// 13. КНОПКИ И ЗАПУСК
// ======================================================

function bindControls() {
  $("search")?.addEventListener("input", renderProgramList);

  $("newProgram")?.addEventListener("click", () => {
    if (!isAdmin()) {
      notify("Создавать программы может только администратор.");
      return;
    }

    createProgram();
  });

  $("manage")?.addEventListener("click", () => {
    if (!isAdmin()) {
      notify("Панель управления доступна только администратору.");
      return;
    }

    $("lesson")?.classList.add("hidden");
    $("adminPanel")?.classList.remove("hidden");
    renderAdminPanel();
  });
}

function start() {
  bindLogin();
  bindControls();

  $("auth")?.classList.remove("hidden");
  $("app")?.classList.add("hidden");
}

start();
