import { useState } from "react";
import {
  ArrowUp, AudioLines, Bell, BookOpen, Brain, Bot, ChevronRight,
  CircleHelp, Command, Database, FileText, FolderKanban, MessageSquare,
  MoreHorizontal, Plug, Plus, Search, Settings2, ShieldCheck, Sparkles, Zap,
  FlaskConical, HardDrive, LockKeyhole, Activity
} from "lucide-react";
import "./mobile-demo.css";

type DemoTab = "chat" | "projects" | "memory" | "knowledge" | "agents" | "files" | "tools" | "training" | "settings" | "more";

const sampleMessages = [
  { role: "assistant" as const, text: "Привет. Я NEXUS, твоя персональная AI-среда. Здесь будут собраны знания, проекты, память и инструменты." },
  { role: "user" as const, text: "Покажи, что ты умеешь." },
  { role: "assistant" as const, text: "Я смогу помогать с исследованиями, планированием, обучением и работой с твоими проектами. Сейчас это демонстрационный интерфейс без подключённой модели." }
];

const demoTools = [
  { name: "Browser", detail: "Поиск и чтение открытых веб-страниц", permission: "Сетевой доступ" },
  { name: "GitHub", detail: "Репозитории, коммиты и задачи", permission: "Доступ к репозиторию" },
  { name: "Workspace files", detail: "Работа с разрешёнными папками", permission: "Разрешение на папку" }
];

export function MobileDemo() {
  const [tab, setTab] = useState<DemoTab>("chat");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(sampleMessages);
  const [notice, setNotice] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeSearched, setKnowledgeSearched] = useState(false);
  const [agentTask, setAgentTask] = useState("");
  const [expandedTool, setExpandedTool] = useState("Browser");

  function sendDemoMessage() {
    const value = draft.trim();
    if (!value) return;
    setMessages(current => [...current, { role: "user", text: value }]);
    setDraft("");
    setNotice("Демо-режим: сообщение не отправлялось AI-модели.");
  }

  const titles: Record<DemoTab, string> = {
    chat: "Новый диалог",
    projects: "Проекты",
    memory: "Память",
    knowledge: "База знаний",
    agents: "Агенты",
    files: "Файловая система",
    tools: "Tools & MCP",
    training: "Training Lab",
    settings: "Настройки",
    more: "Разделы NEXUS"
  };
  const isMoreModule = ["knowledge", "agents", "files", "tools", "training"].includes(tab);

  return <main className="mobile-demo">
    <div className="demo-device">
      <header className="demo-topbar">
        <div className="demo-brand">
          <div className="demo-brand-mark"><Sparkles size={19}/></div>
          <div><strong>NEXUS</strong><span>PERSONAL AI SYSTEM</span></div>
        </div>
        <button className="demo-round-button" aria-label="Уведомления" onClick={() => setNotice("Уведомлений пока нет.")}><Bell size={18}/></button>
      </header>

      <div className="demo-context-row">
        <div><span className="demo-context-label">WORKSPACE</span><strong>{titles[tab]}</strong></div>
        <span className="demo-preview-pill"><span/> PREVIEW</span>
      </div>

      <section className="demo-screen" aria-live="polite">
        {tab === "chat" && <>
          <div className="demo-model-card">
            <div className="demo-model-icon"><Brain size={18}/></div>
            <div><strong>NEXUS Assistant</strong><span>Модель не подключена</span></div>
            <MoreHorizontal size={19}/>
          </div>
          <div className="demo-chat-intro">
            <div className="demo-orb" aria-label="NEXUS holographic core"><div className="demo-orb-inner"><Sparkles size={25}/></div></div>
            <span>YOUR PERSONAL AI</span>
            <h1>Думай шире.<br/>Создавай больше.</h1>
            <p>Единое пространство для идей, знаний и действий.</p>
          </div>
          <div className="demo-messages">
            {messages.map((message, index) => <article className={`demo-message ${message.role}`} key={index}>
              {message.role === "assistant" && <div className="demo-message-avatar"><Sparkles size={14}/></div>}
              <div className="demo-message-bubble">{message.text}</div>
            </article>)}
          </div>
          <div className="demo-suggestions">
            <button onClick={() => setDraft("Помоги спланировать неделю")}><Zap size={14}/> Планирование</button>
            <button onClick={() => setDraft("Изучи эту тему и составь конспект")}><BookOpen size={14}/> Обучение</button>
          </div>
        </>}

        {tab === "projects" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>YOUR WORKSPACE</span><h2>Твои проекты</h2></div><button aria-label="Создать проект" onClick={() => setNotice("Создание проектов будет доступно в рабочей версии.")}><Plus size={18}/></button></div>
          <div className="demo-search"><Search size={16}/><input aria-label="Поиск проектов" value={projectQuery} onChange={event => setProjectQuery(event.target.value)} placeholder="Поиск проектов..."/></div>
          {"NEXUS AU".toLowerCase().includes(projectQuery.trim().toLowerCase()) && <article className="demo-project-card violet"><div className="demo-project-icon"><Command size={19}/></div><span>ACTIVE PROJECT</span><h3>NEXUS AU</h3><p>Персональная AI-экосистема</p><small>Интерфейсный прототип · демонстрационные данные</small></article>}
          {"Личное развитие".toLowerCase().includes(projectQuery.trim().toLowerCase()) && <article className="demo-project-card blue"><div className="demo-project-icon"><Zap size={19}/></div><span>PERSONAL</span><h3>Личное развитие</h3><p>Цели, навыки и планы</p><small>4 заметки</small></article>}
          {"База знаний".toLowerCase().includes(projectQuery.trim().toLowerCase()) && <article className="demo-project-card green"><div className="demo-project-icon"><BookOpen size={19}/></div><span>LEARNING</span><h3>База знаний</h3><p>Материалы и исследования</p><small>12 материалов</small></article>}
          {!["NEXUS AU", "Личное развитие", "База знаний"].some(name => name.toLowerCase().includes(projectQuery.trim().toLowerCase())) && <p className="demo-empty-search">Проекты не найдены.</p>}
        </div>}

        {tab === "memory" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>PERSONAL CONTEXT</span><h2>Память NEXUS</h2></div><button aria-label="Добавить память" onClick={() => setNotice("Управление памятью появится в рабочей версии.")}><Plus size={18}/></button></div>
          <div className="demo-memory-summary"><Brain size={21}/><div><strong>Контекст владельца</strong><span>Демонстрационные записи</span></div><b>08</b></div>
          <div className="demo-memory-group"><span>ПРЕДПОЧТЕНИЯ</span><article><Sparkles size={16}/><div><strong>Стиль общения</strong><p>Прямые ответы, конкретика и аргументы.</p></div></article><article><BookOpen size={16}/><div><strong>Обучение</strong><p>Структурированные объяснения и примеры.</p></div></article></div>
          <div className="demo-memory-group"><span>ПРОЕКТЫ И ЦЕЛИ</span><article><FolderKanban size={16}/><div><strong>NEXUS AU</strong><p>Развитие личной AI-экосистемы.</p></div></article><article><Zap size={16}/><div><strong>Долгосрочные цели</strong><p>Навыки, самостоятельность и развитие.</p></div></article></div>
          <div className="demo-safe-note"><ShieldCheck size={16}/> В рабочей версии память будет доступна для просмотра и управления.</div>
        </div>}

        {tab === "knowledge" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>PROJECT KNOWLEDGE</span><h2>База знаний</h2></div><BookOpen size={21}/></div>
          <div className="demo-module-card"><span>ACTIVE PROJECT</span><strong>NEXUS AU</strong><small>Материалы и заметки проекта</small></div>
          <div className="demo-search demo-knowledge-search"><Search size={16}/><input aria-label="Поиск по базе знаний" value={knowledgeQuery} onChange={event => { setKnowledgeQuery(event.target.value); setKnowledgeSearched(false); }} placeholder="Поиск по документам..."/><button onClick={() => setKnowledgeSearched(true)} disabled={!knowledgeQuery.trim()}>Найти</button></div>
          <button className="demo-document-row" onClick={() => setNotice("В preview доступна только демонстрационная карточка документа.")}><FileText size={18}/><div><strong>ARCHITECTURE.md</strong><small>Архитектура системы · 12.8 KB</small></div><ChevronRight size={16}/></button>
          <button className="demo-document-row" onClick={() => setNotice("В preview доступна только демонстрационная карточка документа.")}><FileText size={18}/><div><strong>ROADMAP.md</strong><small>План разработки · 8.6 KB</small></div><ChevronRight size={16}/></button>
          {knowledgeSearched && <div className="demo-safe-note"><Search size={15}/> Демо-поиск по запросу «{knowledgeQuery}». Реальные документы пока не индексируются в мобильном preview.</div>}
          <div className="demo-safe-note"><ShieldCheck size={16}/> Источники и поиск будут связаны с проектами в рабочей версии.</div>
        </div>}

        {tab === "agents" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>NEXUS AUTOMATION</span><h2>Агенты</h2></div><Bot size={21}/></div>
          <div className="demo-stat-grid"><div><span>AGENTS</span><strong>03</strong></div><div><span>ACTIVE RUNS</span><strong>00</strong></div><div><span>APPROVALS</span><strong>00</strong></div></div>
          <div className="demo-module-card"><span>LOCAL WORKFLOW</span><strong>Task Assistant</strong><small>Ограниченный исполнитель задач с подтверждением действий</small><div className="demo-status-line"><i/> ОЖИДАЕТ ЗАДАЧУ</div></div>
          <label className="demo-field-label">Тестовая задача<textarea aria-label="Тестовая задача для агента" value={agentTask} onChange={event => setAgentTask(event.target.value)} rows={3} placeholder="Опиши задачу для демонстрации..."/></label>
          <button className="demo-primary-action" disabled={!agentTask.trim()} onClick={() => setNotice("Демо-режим: задача не отправлялась агенту и не выполнялась.")}><PlayIcon/> Запустить демо</button>
          <div className="demo-safe-note"><ShieldCheck size={16}/> Реальные агенты будут работать через разрешения, подтверждения и журнал действий.</div>
        </div>}

        {tab === "files" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>DEVICE WORKSPACE</span><h2>Файловая система</h2></div><HardDrive size={21}/></div>
          <div className="demo-module-card"><span>CONNECTION STATUS</span><strong>Не подключено</strong><small>Доступ к папкам Windows пока не активирован</small><div className="demo-status-line warning"><i/> ОЖИДАЕТ РАЗРЕШЕНИЯ</div></div>
          <button className="demo-file-row" onClick={() => setNotice("Выбор папок Windows будет доступен после подключения NEXUS File System.")}><FolderKanban size={18}/><div><strong>Документы</strong><small>Выбранные папки появятся здесь</small></div><ChevronRight size={16}/></button>
          <button className="demo-file-row" onClick={() => setNotice("Папки появятся после выдачи разрешения на доступ.")}><FolderKanban size={18}/><div><strong>Проекты</strong><small>Папки с разрешённым доступом</small></div><ChevronRight size={16}/></button>
          <button className="demo-file-row" onClick={() => setNotice("Последние файлы появятся после подключения файловой системы.")}><FileText size={18}/><div><strong>Последние файлы</strong><small>Список пока пуст</small></div><ChevronRight size={16}/></button>
          <div className="demo-safe-note"><LockKeyhole size={16}/> NEXUS не читает файлы устройства в этом preview. Доступ будет выдаваться отдельно для каждой папки.</div>
        </div>}

        {tab === "tools" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>EXTENSIONS & MCP</span><h2>Tools & MCP</h2></div><Plug size={21}/></div>
          <div className="demo-module-card"><span>TOOL GATEWAY</span><strong>Подключения не настроены</strong><small>Инструменты появятся после подключения и выдачи разрешений</small></div>
          {demoTools.map(tool => <button className="demo-tool-row" key={tool.name} onClick={() => setExpandedTool(current => current === tool.name ? "" : tool.name)} aria-expanded={expandedTool === tool.name}><div><strong>{tool.name}</strong><small>{tool.detail}</small>{expandedTool === tool.name && <em>Требуется: {tool.permission}. Сейчас это только макет.</em>}</div><span>PREVIEW</span></button>)}
          <div className="demo-safe-note"><ShieldCheck size={16}/> Каталог не подключает сервисы и не выдаёт разрешения автоматически.</div>
        </div>}

        {tab === "training" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>MODEL DEVELOPMENT</span><h2>Training Lab</h2></div><FlaskConical size={21}/></div>
          <div className="demo-stat-grid"><div><span>DATASETS</span><strong>03</strong></div><div><span>EXPERIMENTS</span><strong>02</strong></div><div><span>MODELS</span><strong>00</strong></div></div>
          <div className="demo-module-card"><span>DATA GOVERNANCE</span><strong>Наборы данных</strong><small>Лицензия, происхождение, согласие и разделение train / validation / test</small></div>
          <button className="demo-document-row" onClick={() => setNotice("Это демонстрационная запись набора данных.")}><Database size={18}/><div><strong>Baseline dataset</strong><small>Synthetic · CC0 · v1</small></div><ChevronRight size={16}/></button>
          <button className="demo-document-row" onClick={() => setNotice("Это демонстрационная запись оценки модели.")}><Activity size={18}/><div><strong>Evaluation baseline</strong><small>Детерминированная проверка</small></div><ChevronRight size={16}/></button>
          <button className="demo-primary-action" onClick={() => setNotice("Training Lab preview: запуск обучения и изменение весов модели недоступны.")}>Открыть эксперименты</button>
          <div className="demo-safe-note"><ShieldCheck size={16}/> Личные переписки и файлы не добавляются в датасеты автоматически.</div>
        </div>}

        {tab === "settings" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>SYSTEM CONTROL</span><h2>Настройки</h2></div><Settings2 size={21}/></div>
          <div className="demo-settings-profile"><div className="demo-profile-avatar">N</div><div><strong>Владелец NEXUS</strong><span>Личное пространство</span></div><ChevronRight size={18}/></div>
          <div className="demo-settings-group"><span>СИСТЕМА</span><button onClick={() => setNotice("Подключение моделей появится в рабочей версии.")}><Brain size={17}/> Модели и провайдеры <ChevronRight size={17}/></button><button onClick={() => setNotice("Настройки безопасности пока демонстрационные.")}><ShieldCheck size={17}/> Безопасность <ChevronRight size={17}/></button><button onClick={() => setNotice("Настройки уведомлений пока демонстрационные.")}><Bell size={17}/> Уведомления <ChevronRight size={17}/></button></div>
          <div className="demo-settings-group"><span>ПОДДЕРЖКА</span><button onClick={() => setNotice("NEXUS AU — личная AI-экосистема в разработке.")}><CircleHelp size={17}/> О проекте <ChevronRight size={17}/></button><button onClick={() => setNotice("В мобильном preview голос не подключён. В desktop-версии распознавание зависит от поддержки браузера или WebView.")}><AudioLines size={17}/> Голос и звук <ChevronRight size={17}/></button></div>
          <div className="demo-version">NEXUS AU · INTERFACE PREVIEW · 0.2</div>
        </div>}

        {tab === "more" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>NEXUS MODULES</span><h2>Все разделы</h2></div><MoreHorizontal size={21}/></div>
          <p className="demo-more-intro">Дополнительные модули NEXUS AU. Каждый раздел открывает отдельный экран интерфейса.</p>
          <div className="demo-more-grid">
            <button onClick={() => setTab("knowledge")}><div><BookOpen size={19}/></div><span><strong>База знаний</strong><small>Документы и поиск по источникам</small></span><ChevronRight size={16}/></button>
            <button onClick={() => setTab("agents")}><div><Bot size={19}/></div><span><strong>Агенты</strong><small>Задачи, выполнение и подтверждения</small></span><ChevronRight size={16}/></button>
            <button onClick={() => setTab("files")}><div><FileText size={19}/></div><span><strong>Файловая система</strong><small>Файлы и папки устройства</small></span><ChevronRight size={16}/></button>
            <button onClick={() => setTab("tools")}><div><Plug size={19}/></div><span><strong>Tools & MCP</strong><small>Инструменты и интеграции</small></span><ChevronRight size={16}/></button>
            <button onClick={() => setTab("training")}><div><FlaskConical size={19}/></div><span><strong>Training Lab</strong><small>Оценка моделей и эксперименты</small></span><ChevronRight size={16}/></button>
          </div>
          <div className="demo-safe-note"><ShieldCheck size={16}/> Демо-данные не обращаются к AI, устройству или внешним сервисам.</div>
        </div>}
      </section>

      {tab === "chat" && <div className="demo-chat-footer">
        <div className="demo-composer">
          <button className="demo-add-button" aria-label="Добавить вложение" onClick={() => setNotice("Вложения появятся в следующих версиях демо.")}><Plus size={18}/></button>
          <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") sendDemoMessage(); }} placeholder="Напиши сообщение..." aria-label="Сообщение"/>
          <button className="demo-send-button" onClick={sendDemoMessage} aria-label="Отправить сообщение"><ArrowUp size={18}/></button>
        </div>
        <p className="demo-disclaimer">Демо-режим · сообщения не отправляются модели</p>
      </div>}

      {notice && <button className="demo-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      <nav className="demo-tabbar" aria-label="Основная навигация">
        <button className={tab === "chat" ? "active" : ""} aria-pressed={tab === "chat"} onClick={() => setTab("chat")}><MessageSquare size={19}/><span>Чат</span></button>
        <button className={tab === "projects" ? "active" : ""} aria-pressed={tab === "projects"} onClick={() => setTab("projects")}><FolderKanban size={19}/><span>Проекты</span></button>
        <button className={tab === "memory" ? "active" : ""} aria-pressed={tab === "memory"} onClick={() => setTab("memory")}><Brain size={19}/><span>Память</span></button>
        <button className={tab === "settings" ? "active" : ""} aria-pressed={tab === "settings"} onClick={() => setTab("settings")}><Settings2 size={19}/><span>Настройки</span></button>
        <button className={tab === "more" || isMoreModule ? "active" : ""} aria-pressed={tab === "more" || isMoreModule} onClick={() => setTab("more")}><MoreHorizontal size={19}/><span>Ещё</span></button>
      </nav>
      <div className="demo-home-indicator"/>
    </div>
    <div className="demo-outside-label"><span/> NEXUS AU <b>·</b> MOBILE INTERFACE CONCEPT</div>
  </main>;
}

function PlayIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>;
}
