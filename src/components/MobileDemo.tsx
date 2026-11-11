import { useState } from "react";
import {
  ArrowUp, AudioLines, Bell, BookOpen, Brain, ChevronRight,
  CircleHelp, Command, FolderKanban, MessageSquare, MoreHorizontal,
  Plus, Search, Settings2, ShieldCheck, Sparkles, Zap
} from "lucide-react";
import "./mobile-demo.css";

type DemoTab = "chat" | "projects" | "memory" | "settings";

const sampleMessages = [
  { role: "assistant" as const, text: "Привет. Я NEXUS, твоя персональная AI-среда. Здесь будут собраны знания, проекты, память и инструменты." },
  { role: "user" as const, text: "Покажи, что ты умеешь." },
  { role: "assistant" as const, text: "Я смогу помогать с исследованиями, планированием, обучением и работой с твоими проектами. Сейчас это демонстрационный интерфейс без подключённой модели." }
];

export function MobileDemo() {
  const [tab, setTab] = useState<DemoTab>("chat");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState(sampleMessages);
  const [notice, setNotice] = useState("");

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
    settings: "Настройки"
  };

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
            <div className="demo-orb"><Sparkles size={25}/></div>
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
          <div className="demo-composer">
            <button className="demo-add-button" aria-label="Добавить вложение" onClick={() => setNotice("Вложения появятся в следующих версиях демо.")}><Plus size={18}/></button>
            <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") sendDemoMessage(); }} placeholder="Напиши сообщение..." aria-label="Сообщение"/>
            <button className="demo-send-button" onClick={sendDemoMessage} aria-label="Отправить сообщение"><ArrowUp size={18}/></button>
          </div>
          <p className="demo-disclaimer">Демонстрация интерфейса · AI не подключён</p>
        </>}

        {tab === "projects" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>YOUR WORKSPACE</span><h2>Твои проекты</h2></div><button onClick={() => setNotice("Создание проектов будет доступно в рабочей версии.")}><Plus size={18}/></button></div>
          <div className="demo-search"><Search size={16}/><span>Поиск проектов</span></div>
          <article className="demo-project-card violet"><div className="demo-project-icon"><Command size={19}/></div><span>ACTIVE PROJECT</span><h3>NEXUS AU</h3><p>Персональная AI-экосистема</p><div className="demo-progress"><i style={{width:"68%"}}/></div><small>В разработке</small></article>
          <article className="demo-project-card blue"><div className="demo-project-icon"><Zap size={19}/></div><span>PERSONAL</span><h3>Личное развитие</h3><p>Цели, навыки и планы</p><small>4 заметки</small></article>
          <article className="demo-project-card green"><div className="demo-project-icon"><BookOpen size={19}/></div><span>LEARNING</span><h3>База знаний</h3><p>Материалы и исследования</p><small>12 материалов</small></article>
        </div>}

        {tab === "memory" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>PERSONAL CONTEXT</span><h2>Память NEXUS</h2></div><button onClick={() => setNotice("Управление памятью появится в рабочей версии.")}><Plus size={18}/></button></div>
          <div className="demo-memory-summary"><Brain size={21}/><div><strong>Контекст владельца</strong><span>Демонстрационные записи</span></div><b>08</b></div>
          <div className="demo-memory-group"><span>ПРЕДПОЧТЕНИЯ</span><article><Sparkles size={16}/><div><strong>Стиль общения</strong><p>Прямые ответы, конкретика и аргументы.</p></div></article><article><BookOpen size={16}/><div><strong>Обучение</strong><p>Структурированные объяснения и примеры.</p></div></article></div>
          <div className="demo-memory-group"><span>ПРОЕКТЫ И ЦЕЛИ</span><article><FolderKanban size={16}/><div><strong>NEXUS AU</strong><p>Развитие личной AI-экосистемы.</p></div></article><article><Zap size={16}/><div><strong>Долгосрочные цели</strong><p>Навыки, самостоятельность и развитие.</p></div></article></div>
          <div className="demo-safe-note"><ShieldCheck size={16}/> В реальной версии память будет доступна для просмотра и управления.</div>
        </div>}

        {tab === "settings" && <div className="demo-section">
          <div className="demo-section-heading"><div><span>SYSTEM CONTROL</span><h2>Настройки</h2></div><Settings2 size={21}/></div>
          <div className="demo-settings-profile"><div className="demo-profile-avatar">N</div><div><strong>Владелец NEXUS</strong><span>Личное пространство</span></div><ChevronRight size={18}/></div>
          <div className="demo-settings-group"><span>СИСТЕМА</span><button onClick={() => setNotice("Подключение моделей появится в рабочей версии.")}><Brain size={17}/> Модели и провайдеры <ChevronRight size={17}/></button><button onClick={() => setNotice("Настройки безопасности пока демонстрационные.")}><ShieldCheck size={17}/> Безопасность <ChevronRight size={17}/></button><button onClick={() => setNotice("Настройки уведомлений пока демонстрационные.")}><Bell size={17}/> Уведомления <ChevronRight size={17}/></button></div>
          <div className="demo-settings-group"><span>ПОДДЕРЖКА</span><button onClick={() => setNotice("NEXUS AU — личная AI-экосистема в разработке.")}><CircleHelp size={17}/> О проекте <ChevronRight size={17}/></button><button onClick={() => setNotice("Голосовые функции пока не подключены.")}><AudioLines size={17}/> Голос и звук <ChevronRight size={17}/></button></div>
          <div className="demo-version">NEXUS AU · INTERFACE PREVIEW · 0.1</div>
        </div>}
      </section>

      {notice && <button className="demo-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      <nav className="demo-tabbar" aria-label="Основная навигация">
        <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}><MessageSquare size={19}/><span>Чат</span></button>
        <button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}><FolderKanban size={19}/><span>Проекты</span></button>
        <button className={tab === "memory" ? "active" : ""} onClick={() => setTab("memory")}><Brain size={19}/><span>Память</span></button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings2 size={19}/><span>Настройки</span></button>
      </nav>
      <div className="demo-home-indicator"/>
    </div>
    <div className="demo-outside-label"><span/> NEXUS AU <b>·</b> MOBILE INTERFACE CONCEPT</div>
  </main>;
}
