import { DEMO_ROSTER, type RosterBot } from "../demo";
import { SITE_DESCRIPTION } from "../site";
import type { Locale } from "./locales";

export type HomeCopy = {
  title: string;
  description: string;
  ogImageAlt: string;
  availableLanguage: string;
  skipToContent: string;
  starFallback: string;
  nav: {
    home: string;
    primary: string;
    menu: string;
    product: string;
    bots: string;
    selfHost: string;
    openSource: string;
    docs: string;
    viewOnGithub: string;
  };
  hero: {
    badge: string;
    pill: string;
    heading: string;
    lead: string;
    getStarted: string;
    viewOnGithub: string;
    setupWithAgent: string;
    copiedForAgent: string;
    copyFailed: string;
  };
  selfHost: {
    eyebrow: string;
    heading: string;
    copy: string;
    features: Array<{ title: string; body: string }>;
  };
  tools: {
    eyebrow: string;
    heading: string;
    copy: string;
  };
  illustrations: {
    models: { caption: string };
    routines: {
      rows: Array<{ title: string; range: string }>;
      dayLabels: string[];
      nowLabel: string;
      caption: string;
    };
    approvals: {
      items: Array<{ label: string; asks?: boolean }>;
      doneLabel: string;
      asksLabel: string;
      caption: string;
    };
    tools: { caption: string };
  };
  roster: {
    eyebrow: string;
    heading: string;
    copy: string;
    bots: RosterBot[];
  };
  openSource: {
    eyebrow: string;
    heading: string;
    copy: string;
    selfHostTitle: string;
    selfHostMeta: string;
    selfHostItems: string[];
    starOnGithub: string;
    readTheDocs: string;
    cloudTitle: string;
    cloudBadge: string;
    cloudMeta: string;
    cloudItems: string[];
    getStarted: string;
  };
  cta: {
    heading: string;
    copy: string;
    getStarted: string;
    viewOnGithub: string;
    openSourceValue: string;
    selfHostValue: string;
    stats: Array<{ value: "stars" | "license" | "openSource" | "selfHost"; label: string }>;
  };
  getStartedDialog: {
    closeLabel: string;
    eyebrow: string;
    title: string;
    copy: string;
    selfHostNow: string;
    selfHostHint: string;
    cloudWaitlist: string;
    cloudHint: string;
    back: string;
    successTitle: string;
    successCopy: string;
    done: string;
    viewOnGithub: string;
  };
  waitlist: {
    emailLabel: string;
    placeholder: string;
    submit: string;
    joining: string;
    success: string;
    added: string;
    error: string;
  };
  footer: {
    navLabel: string;
    languagesLabel: string;
    links: {
      docs: string;
      changelog: string;
      about: string;
      support: string;
      privacy: string;
    };
  };
};

const EN_ROSTER = DEMO_ROSTER;

const DE_ROSTER: RosterBot[] = [
  {
    name: "Sales Outbound",
    color: "#F5A03C",
    slug: "rakazo/sales-outbound",
    desc: "Recherchiert nachts Accounts, bewertet Intent, entwirft in deinem Ton und hinterlässt eine Review-Liste.",
  },
  {
    name: "Inbox Manager",
    color: "#6A6BF5",
    slug: "rakazo/inbox-manager",
    desc: "Archiviert den Lärm, antwortet auf Routine-Threads und parkt Entwürfe, die du lesen solltest.",
  },
  {
    name: "Talent Scout",
    color: "#3B82F6",
    slug: "rakazo/talent-scout",
    desc: "Liest jede Bewerbung, shortlistet nach deiner Latte und schreibt die Intro-Mails.",
  },
  {
    name: "Expense Manager",
    color: "#F2622A",
    slug: "rakazo/expense-manager",
    desc: "Ordnet Belege den Buchungen zu, reicht den Report ein und fragt nach, statt zu raten.",
  },
  {
    name: "Bug Triage",
    color: "#D9508A",
    slug: "rakazo/bug-triage",
    desc: "Reproduziert Reports in einem echten Browser und hängt die Schritte an das Issue.",
  },
  {
    name: "Account Manager",
    color: "#9B5CF6",
    slug: "rakazo/account-manager",
    desc: "Hält Renewal-Kontext, beantwortet bekannte Fragen und eskaliert den Rest.",
  },
  {
    name: "Paid Media",
    color: "#3EC5A8",
    slug: "rakazo/paid-media",
    desc: "Überwacht den Spend täglich, pausiert, was nicht konvertiert, und meldet, was sich geändert hat.",
  },
  {
    name: "Chief of Staff",
    color: "#8B93A8",
    slug: "rakazo/chief-of-staff",
    desc: "Führt die Woche: Briefings, Buchungen und Übergaben zwischen deinen anderen Bots.",
  },
];

const KO_ROSTER: RosterBot[] = [
  {
    name: "Sales Outbound",
    color: "#F5A03C",
    slug: "rakazo/sales-outbound",
    desc: "밤새 계정을 조사하고 의도를 점수한 뒤, 당신 말투로 초안을 써 검토 목록을 남깁니다.",
  },
  {
    name: "Inbox Manager",
    color: "#6A6BF5",
    slug: "rakazo/inbox-manager",
    desc: "잡음을 보관처리하고, 루틴 스레드에 답하며, 확인이 필요한 초안은 보류합니다.",
  },
  {
    name: "Talent Scout",
    color: "#3B82F6",
    slug: "rakazo/talent-scout",
    desc: "지원서를 모두 읽고 기준에 맞게 숏리스트한 뒤 소개 메일을 작성합니다.",
  },
  {
    name: "Expense Manager",
    color: "#F2622A",
    slug: "rakazo/expense-manager",
    desc: "영수증과 결제를 맞추고 리포트를 제출하며, 추측하기 전에 묻습니다.",
  },
  {
    name: "Bug Triage",
    color: "#D9508A",
    slug: "rakazo/bug-triage",
    desc: "실제 브라우저에서 리포트를 재현하고 이슈에 재현 절차를 붙입니다.",
  },
  {
    name: "Account Manager",
    color: "#9B5CF6",
    slug: "rakazo/account-manager",
    desc: "갱신 맥락을 유지하고 알려진 질문에 답하며, 나머지는 에스컬레이션합니다.",
  },
  {
    name: "Paid Media",
    color: "#3EC5A8",
    slug: "rakazo/paid-media",
    desc: "매일 지출을 지켜보고 전환되지 않는 건 일시정지한 뒤, 바뀐 점을 보고합니다.",
  },
  {
    name: "Chief of Staff",
    color: "#8B93A8",
    slug: "rakazo/chief-of-staff",
    desc: "한 주를 운영합니다: 브리핑, 예약, 다른 봇 사이의 핸드오프.",
  },
];

const ZH_ROSTER: RosterBot[] = [
  {
    name: "Sales Outbound",
    color: "#F5A03C",
    slug: "rakazo/sales-outbound",
    desc: "夜间调研客户、评估意向，用你的语气起草跟进，并留下待审清单。",
  },
  {
    name: "Inbox Manager",
    color: "#6A6BF5",
    slug: "rakazo/inbox-manager",
    desc: "归档杂音、回复例行邮件，把需要你过目的草稿先搁置起来。",
  },
  {
    name: "Talent Scout",
    color: "#3B82F6",
    slug: "rakazo/talent-scout",
    desc: "通读每份简历，按你的标准筛出候选名单，并写好介绍邮件。",
  },
  {
    name: "Expense Manager",
    color: "#F2622A",
    slug: "rakazo/expense-manager",
    desc: "核对票据与账目、提交报销，拿不准时先问而不是猜。",
  },
  {
    name: "Bug Triage",
    color: "#D9508A",
    slug: "rakazo/bug-triage",
    desc: "在真实浏览器里复现报告，并把复现步骤附到工单上。",
  },
  {
    name: "Account Manager",
    color: "#9B5CF6",
    slug: "rakazo/account-manager",
    desc: "掌握续约背景，回答常见问题，其余的自动升级给你。",
  },
  {
    name: "Paid Media",
    color: "#3EC5A8",
    slug: "rakazo/paid-media",
    desc: "每天盯投放，暂停没有转化的广告，并汇报发生了什么变化。",
  },
  {
    name: "Chief of Staff",
    color: "#8B93A8",
    slug: "rakazo/chief-of-staff",
    desc: "统筹整周：准备简报、安排日程，并协调其他 Bot 之间的交接。",
  },
];

const HOME_COPY: Record<Locale, HomeCopy> = {
  en: {
    title: "Rakazo | Open source Grok Bot alternative",
    description: SITE_DESCRIPTION,
    ogImageAlt:
      "Rakazo. AI teammates you actually own. Your keys, your model, your machine.",
    availableLanguage: "English",
    skipToContent: "Skip to content",
    starFallback: "Star",
    nav: {
      home: "Rakazo home",
      primary: "Primary",
      menu: "Menu",
      product: "Product",
      bots: "Bots",
      selfHost: "Self-host",
      openSource: "Open source",
      docs: "Docs",
      viewOnGithub: "View on GitHub",
    },
    hero: {
      badge: "Apache-2.0",
      pill: "Self-hosted",
      heading: "AI teammates you actually own",
      lead: "Hand a bot the work you keep putting off. It signs in to your tools, finishes the job while you sleep, and comes back only when a decision is yours to make. Rakazo is the open source Grok Bot alternative — your keys, your model, your machine.",
      getStarted: "Get started",
      viewOnGithub: "View on GitHub",
      setupWithAgent: "Set up with your agent",
      copiedForAgent: "Copied for your agent",
      copyFailed: "Copy failed. Try again.",
    },
    selfHost: {
      eyebrow: "Self-hosted",
      heading: "The computer is yours",
      copy: "Run Rakazo on your machine. Your keys, your model, your data.",
      features: [
        {
          title: "Never locked to one model",
          body: "Point each bot at Claude, GPT, Grok, or a model on your own hardware. The cheap one triages, the smart one writes, and you pay the provider directly.",
        },
        {
          title: "Set it once, it runs every day",
          body: "Show a bot a job once and it keeps the routine in plain Markdown \u2014 a file you can read, edit, and commit like any other.",
        },
        {
          title: "It stops before it costs you",
          body: "You decide what a bot does alone and what it has to ask about. Every action lands in an audit log on your own machine.",
        },
      ],
    },
    tools: {
      eyebrow: "Connected",
      heading: "It works where your work already lives",
      copy: "A bot signs in to the tools you already pay for and uses them the way you would \u2014 a real session in a real browser, not a pile of brittle API glue.",
    },
    illustrations: {
      models: {
        caption: "Six model providers connected to one Rakazo instance that you run.",
      },
      routines: {
        rows: [
          { title: "Triage the inbox", range: "Every weekday \u00b7 07:00" },
          { title: "Research new accounts", range: "Nightly \u00b7 02:00" },
          { title: "Watch ad spend", range: "Daily \u00b7 09:00" },
        ],
        dayLabels: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
        nowLabel: "NOW",
        caption: "Three saved routines running across a week, with a marker on the current time.",
      },
      approvals: {
        items: [
          { label: "Archived 214 newsletters" },
          { label: "Replied to 6 routine threads" },
          { label: "Booked Tuesday's standup" },
          { label: "Refund $2,400 to Northwind", asks: true },
          { label: "Send the signed contract", asks: true },
        ],
        doneLabel: "Done",
        asksLabel: "Asks you",
        caption: "Routine actions completed on their own; consequential ones held for approval.",
      },
      tools: {
        caption: "A wall of apps a bot can sign in to and operate.",
      },
    },
    roster: {
      eyebrow: "Bot Templates",
      heading: "Give each bot a job",
      copy: "Start a new bot and it interviews you. A few questions about the work, how you write, and where it lives. Then it gets going.",
      bots: EN_ROSTER,
    },
    openSource: {
      eyebrow: "Open source",
      heading: "No pricing page. Just the repo.",
      copy: "Rakazo is Apache-2.0 licensed and runs on your own machine with your own model keys. Nothing is gated, nothing phones home.",
      selfHostTitle: "Self-host",
      selfHostMeta: "Available today",
      selfHostItems: [
        "Docker runner and sandboxed browser",
        "Bring your own model keys",
        "Routines, memory, and audit log",
        "Unlimited bots, no seats, no limits",
        "Community support on GitHub",
      ],
      starOnGithub: "Star on GitHub",
      readTheDocs: "Read the docs",
      cloudTitle: "Cloud",
      cloudBadge: "Coming soon",
      cloudMeta: "Bring your own keys, we run the computers",
      cloudItems: [
        "Managed sandboxes, always on",
        "Your keys, your model spend",
        "Same bots, same routines, no migration",
      ],
      getStarted: "Get started",
    },
    cta: {
      heading: "Meet your first bot",
      copy: "Give Rakazo something you have been putting off and let it handle the follow-through.",
      getStarted: "Get started",
      viewOnGithub: "View on GitHub",
      openSourceValue: "Open source",
      selfHostValue: "Self-host",
      stats: [
        { value: "stars", label: "GitHub stars" },
        { value: "license", label: "License" },
        { value: "openSource", label: "No seats, no gates" },
        { value: "selfHost", label: "Your machine" },
      ],
    },
    getStartedDialog: {
      closeLabel: "Close get started dialog",
      eyebrow: "Get started",
      title: "How do you want to start?",
      copy: "Self-host on your machine, or join the Cloud waitlist.",
      selfHostNow: "Self-host now",
      selfHostHint: "Install steps are in the docs.",
      cloudWaitlist: "Cloud waitlist",
      cloudHint: "Hosted Rakazo is coming. Leave your email.",
      back: "Back",
      successTitle: "You're in.",
      successCopy:
        "We'll email you when hosted Rakazo is ready. Want to start today? Jump to Self-host on this page.",
      done: "Done",
      viewOnGithub: "View on GitHub",
    },
    waitlist: {
      emailLabel: "Email address",
      placeholder: "you@company.com",
      submit: "Continue",
      joining: "Joining…",
      success: "You’re in.",
      added: "Added",
      error: "Couldn’t add you. Try again.",
    },
    footer: {
      navLabel: "Footer",
      languagesLabel: "Language",
      links: {
        docs: "Docs",
        changelog: "Changelog",
        about: "About",
        support: "Support",
        privacy: "Privacy",
      },
    },
  },
  de: {
    title: "Rakazo | Open-Source-Alternative zu Grok Bot",
    description:
      "Rakazo ist eine Open-Source-Alternative zu Grok Bot für persistente KI-Teamkollegen, die echte Arbeit erledigen. Deine Keys, dein Modell, deine Maschine.",
    ogImageAlt:
      "Rakazo. KI-Teamkollegen, die dir wirklich gehören. Deine Keys, dein Modell, deine Maschine.",
    availableLanguage: "German",
    skipToContent: "Zum Inhalt springen",
    starFallback: "Star",
    nav: {
      home: "Rakazo-Startseite",
      primary: "Hauptnavigation",
      menu: "Menü",
      product: "Produkt",
      bots: "Bots",
      selfHost: "Self-host",
      openSource: "Open Source",
      docs: "Docs",
      viewOnGithub: "Auf GitHub ansehen",
    },
    hero: {
      badge: "Apache-2.0",
      pill: "Self-hosted",
      heading: "KI-Teamkollegen, die dir wirklich gehören",
      lead: "Gib einem Bot die Arbeit, die du vor dir herschiebst. Er meldet sich in deinen Tools an, erledigt sie über Nacht und kommt nur zurück, wenn du entscheiden musst. Rakazo ist die Open-Source-Alternative zu Grok Bot — deine Keys, dein Modell, deine Maschine.",
      getStarted: "Loslegen",
      viewOnGithub: "Auf GitHub ansehen",
      setupWithAgent: "Mit deinem Agenten einrichten",
      copiedForAgent: "Für deinen Agenten kopiert",
      copyFailed: "Kopieren fehlgeschlagen. Erneut versuchen.",
    },
    selfHost: {
      eyebrow: "Self-hosted",
      heading: "Der Computer gehört dir",
      copy: "Betreibe Rakazo auf deiner Maschine. Deine Keys, dein Modell, deine Daten.",
      features: [
        {
          title: "Nie an ein Modell gebunden",
          body: "Richte jeden Bot auf Claude, GPT, Grok oder ein Modell auf deiner eigenen Hardware. Das g\u00fcnstige triagiert, das starke schreibt \u2014 und du zahlst direkt beim Anbieter.",
        },
        {
          title: "Einmal zeigen, t\u00e4glich erledigt",
          body: "Zeig einem Bot eine Aufgabe einmal. Er beh\u00e4lt die Routine als schlichtes Markdown \u2014 eine Datei, die du lesen, \u00e4ndern und committen kannst.",
        },
        {
          title: "Er stoppt, bevor es teuer wird",
          body: "Du entscheidest, was ein Bot allein tut und wof\u00fcr er fragen muss. Jede Aktion landet in einem Audit-Log auf deiner Maschine.",
        },
      ],
    },
    tools: {
      eyebrow: "Verbunden",
      heading: "Er arbeitet dort, wo deine Arbeit schon liegt",
      copy: "Ein Bot meldet sich in den Tools an, die du ohnehin bezahlst, und nutzt sie wie du \u2014 echte Sessions in einem echten Browser statt br\u00fcchigem API-Kleber.",
    },
    illustrations: {
      models: {
        caption: "Sechs Modellanbieter, verbunden mit einer Rakazo-Instanz, die du betreibst.",
      },
      routines: {
        rows: [
          { title: "Postfach triagieren", range: "Jeden Werktag \u00b7 07:00" },
          { title: "Neue Accounts recherchieren", range: "N\u00e4chtlich \u00b7 02:00" },
          { title: "Ad-Spend pr\u00fcfen", range: "T\u00e4glich \u00b7 09:00" },
        ],
        dayLabels: ["MO", "DI", "MI", "DO", "FR", "SA", "SO"],
        nowLabel: "JETZT",
        caption: "Drei gespeicherte Routinen \u00fcber eine Woche, mit Markierung auf der aktuellen Zeit.",
      },
      approvals: {
        items: [
          { label: "214 Newsletter archiviert" },
          { label: "6 Routine-Threads beantwortet" },
          { label: "Dienstags-Standup gebucht" },
          { label: "2.400 $ an Northwind erstatten", asks: true },
          { label: "Unterschriebenen Vertrag senden", asks: true },
        ],
        doneLabel: "Erledigt",
        asksLabel: "Fragt dich",
        caption: "Routineaktionen laufen allein; folgenreiche warten auf deine Freigabe.",
      },
      tools: {
        caption: "Eine Wand aus Apps, in denen ein Bot sich anmelden und arbeiten kann.",
      },
    },
    roster: {
      eyebrow: "Bot-Vorlagen",
      heading: "Gib jedem Bot eine Aufgabe",
      copy: "Starte einen neuen Bot und er interviewt dich. Ein paar Fragen zur Arbeit, zu deinem Schreibstil und wo sie lebt. Dann legt er los.",
      bots: DE_ROSTER,
    },
    openSource: {
      eyebrow: "Open Source",
      heading: "Keine Preisseite. Nur das Repo.",
      copy: "Rakazo ist Apache-2.0-lizenziert und läuft auf deiner Maschine mit deinen Model-Keys. Nichts ist freigeschaltet, nichts telefoniert nach Hause.",
      selfHostTitle: "Self-host",
      selfHostMeta: "Heute verfügbar",
      selfHostItems: [
        "Docker-Runner und sandboxierter Browser",
        "Eigene Model-Keys mitbringen",
        "Routinen, Memory und Audit-Log",
        "Unbegrenzte Bots, keine Seats, keine Limits",
        "Community-Support auf GitHub",
      ],
      starOnGithub: "Auf GitHub mit Stern markieren",
      readTheDocs: "Docs lesen",
      cloudTitle: "Cloud",
      cloudBadge: "Demnächst",
      cloudMeta: "Deine Keys, wir betreiben die Computer",
      cloudItems: [
        "Managed Sandboxes, immer an",
        "Deine Keys, dein Model-Spend",
        "Dieselben Bots, dieselben Routinen, keine Migration",
      ],
      getStarted: "Loslegen",
    },
    cta: {
      heading: "Triff deinen ersten Bot",
      copy: "Gib Rakazo etwas, das du aufgeschoben hast — und lass es den Follow-through übernehmen.",
      getStarted: "Loslegen",
      viewOnGithub: "Auf GitHub ansehen",
      openSourceValue: "Open Source",
      selfHostValue: "Self-host",
      stats: [
        { value: "stars", label: "GitHub Stars" },
        { value: "license", label: "Lizenz" },
        { value: "openSource", label: "Keine Seats, keine Gates" },
        { value: "selfHost", label: "Deine Maschine" },
      ],
    },
    getStartedDialog: {
      closeLabel: "Loslegen-Dialog schließen",
      eyebrow: "Loslegen",
      title: "Wie willst du starten?",
      copy: "Self-host auf deiner Maschine, oder auf die Cloud-Warteliste.",
      selfHostNow: "Jetzt self-hosten",
      selfHostHint: "Installationsschritte stehen in den Docs.",
      cloudWaitlist: "Cloud-Warteliste",
      cloudHint: "Gehostetes Rakazo kommt. Hinterlasse deine E-Mail.",
      back: "Zurück",
      successTitle: "Du bist dabei.",
      successCopy:
        "Wir mailen dir, wenn gehostetes Rakazo bereit ist. Heute starten? Zum Self-host-Abschnitt auf dieser Seite.",
      done: "Fertig",
      viewOnGithub: "Auf GitHub ansehen",
    },
    waitlist: {
      emailLabel: "E-Mail-Adresse",
      placeholder: "du@firma.com",
      submit: "Weiter",
      joining: "Wird eingetragen…",
      success: "Du bist dabei.",
      added: "Hinzugefügt",
      error: "Konnte dich nicht eintragen. Bitte erneut versuchen.",
    },
    footer: {
      navLabel: "Fußzeile",
      languagesLabel: "Sprache",
      links: {
        docs: "Dokumentation",
        changelog: "Änderungsprotokoll",
        about: "Über uns",
        support: "Support",
        privacy: "Datenschutz",
      },
    },
  },
  ko: {
    title: "Rakazo | 오픈소스 Grok Bot 대안",
    description:
      "Rakazo는 실제 업무를 수행하는 지속형 AI 팀원을 위한 오픈소스 Grok Bot 대안입니다. 키, 모델, 머신, 모두 당신 것.",
    ogImageAlt: "Rakazo. 진짜로 내 것인 AI 팀원. 키, 모델, 머신, 모두 당신 것.",
    availableLanguage: "Korean",
    skipToContent: "본문으로 건너뛰기",
    starFallback: "Star",
    nav: {
      home: "Rakazo 홈",
      primary: "주 메뉴",
      menu: "메뉴",
      product: "제품",
      bots: "봇",
      selfHost: "셀프 호스트",
      openSource: "오픈소스",
      docs: "Docs",
      viewOnGithub: "GitHub에서 보기",
    },
    hero: {
      badge: "Apache-2.0",
      pill: "셀프 호스트",
      heading: "진짜로 내 것인 AI 팀원",
      lead: "계속 미뤄둔 일을 봇에게 넘기세요. 봇은 당신의 도구에 로그인해 밤사이에 일을 끝내고, 판단이 필요한 순간에만 돌아옵니다. Rakazo는 오픈소스 Grok Bot 대안입니다. 내 키, 내 모델, 내 장비로.",
      getStarted: "시작하기",
      viewOnGithub: "GitHub에서 보기",
      setupWithAgent: "에이전트로 설정하기",
      copiedForAgent: "에이전트용으로 복사됨",
      copyFailed: "복사 실패. 다시 시도하세요.",
    },
    selfHost: {
      eyebrow: "셀프 호스트",
      heading: "컴퓨터는 당신 것",
      copy: "당신 머신에서 Rakazo를 실행하세요. 키, 모델, 데이터는 모두 당신 것.",
      features: [
        {
          title: "\ud55c \ubaa8\ub378\uc5d0 \ubb36\uc774\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4",
          body: "\ubd07\ub9c8\ub2e4 Claude, GPT, Grok, \ub610\ub294 \ub0b4 \uc7a5\ube44\uc758 \ubaa8\ub378\uc744 \uace8\ub77c \ubd99\uc774\uc138\uc694. \uc800\ub834\ud55c \ubaa8\ub378\uc774 \ubd84\ub958\ud558\uace0 \ub611\ub611\ud55c \ubaa8\ub378\uc774 \uc53c\ub2c8\ub2e4. \ube44\uc6a9\uc740 \uacf5\uae09\uc0ac\uc5d0 \uc9c1\uc811 \ub0c5\ub2c8\ub2e4.",
        },
        {
          title: "\ud55c \ubc88 \ubcf4\uc5ec\uc8fc\uba74 \ub9e4\uc77c \ub3d5\ub2c8\ub2e4",
          body: "\uc77c\uc744 \ud55c \ubc88\ub9cc \ubcf4\uc5ec\uc8fc\uc138\uc694. \ubd07\uc740 \uadf8 \ub8e8\ud2f4\uc744 \ud3c9\ubc94\ud55c Markdown\uc73c\ub85c \ub0a8\uae41\ub2c8\ub2e4. \uc77d\uace0 \uace0\uce58\uace0 \ucee4\ubc0b\ud560 \uc218 \uc788\ub294 \ud30c\uc77c\uc785\ub2c8\ub2e4.",
        },
        {
          title: "\ube44\uc2fc \uc2e4\uc218 \uc55e\uc5d0\uc11c \uba48\ucda5\ub2c8\ub2e4",
          body: "\ubb34\uc5c7\uc744 \ud63c\uc790 \ud558\uace0 \ubb34\uc5c7\uc744 \ubb3c\uc744\uc9c0 \ub2f9\uc2e0\uc774 \uc815\ud569\ub2c8\ub2e4. \ubaa8\ub4e0 \ud589\ub3d9\uc740 \ub0b4 \uc7a5\ube44\uc758 \uac10\uc0ac \ub85c\uadf8\uc5d0 \ub0a8\uc2b5\ub2c8\ub2e4.",
        },
      ],
    },
    tools: {
      eyebrow: "\uc5f0\uacb0",
      heading: "\uc77c\uc774 \uc774\ubbf8 \uc788\ub294 \uacf3\uc5d0\uc11c \uc77c\ud569\ub2c8\ub2e4",
      copy: "\ubd07\uc740 \ub2f9\uc2e0\uc774 \uc774\ubbf8 \uc4f0\ub294 \ub3c4\uad6c\uc5d0 \ub85c\uadf8\uc778\ud574 \ub2f9\uc2e0\ucc98\ub7fc \uc0ac\uc6a9\ud569\ub2c8\ub2e4. \uc9c4\uc9dc \ube0c\ub77c\uc6b0\uc800\uc758 \uc9c4\uc9dc \uc138\uc158\uc774\uc9c0, \ubd80\uc11c\uc9c0\uae30 \uc26c\uc6b4 API \uc811\ucc29\uc81c\uac00 \uc544\ub2d9\ub2c8\ub2e4.",
    },
    illustrations: {
      models: {
        caption: "\uc9c1\uc811 \uc6b4\uc601\ud558\ub294 Rakazo \uc778\uc2a4\ud134\uc2a4 \ud558\ub098\uc5d0 \uc5f0\uacb0\ub41c \uc5ec\uc12f \uac1c\uc758 \ubaa8\ub378 \uacf5\uae09\uc0ac.",
      },
      routines: {
        rows: [
          { title: "\uc218\uc2e0\ud568 \uc815\ub9ac", range: "\ud3c9\uc77c\ub9c8\ub2e4 \u00b7 07:00" },
          { title: "\uc2e0\uaddc \uacc4\uc815 \uc870\uc0ac", range: "\ub9e4\uc77c \ubc24 \u00b7 02:00" },
          { title: "\uad11\uace0 \uc9c0\ucd9c \uc810\uac80", range: "\ub9e4\uc77c \u00b7 09:00" },
        ],
        dayLabels: ["\uc6d4", "\ud654", "\uc218", "\ubaa9", "\uae08", "\ud1a0", "\uc77c"],
        nowLabel: "\uc9c0\uae08",
        caption: "\ud55c \uc8fc \ub3d9\uc548 \uc2e4\ud589\ub418\ub294 \ub8e8\ud2f4 \uc138 \uac1c\uc640 \ud604\uc7ac \uc2dc\uac01 \ud45c\uc2dc.",
      },
      approvals: {
        items: [
          { label: "\ub274\uc2a4\ub808\ud130 214\uac1c \ubcf4\uad00" },
          { label: "\ub8e8\ud2f4 \uc2a4\ub808\ub4dc 6\uac1c \ud68c\uc2e0" },
          { label: "\ud654\uc694\uc77c \uc2a4\ud0e0\ub4dc\uc5c5 \uc608\uc57d" },
          { label: "Northwind\uc5d0 $2,400 \ud658\ubd88", asks: true },
          { label: "\uc11c\uba85\ub41c \uacc4\uc57d\uc11c \ubc1c\uc1a1", asks: true },
        ],
        doneLabel: "\uc644\ub8cc",
        asksLabel: "\ud655\uc778 \uc694\uccad",
        caption: "\ub8e8\ud2f4 \uc791\uc5c5\uc740 \uc2a4\uc2a4\ub85c \ub05d\ub0b4\uace0, \uc911\uc694\ud55c \uc791\uc5c5\uc740 \uc2b9\uc778\uc744 \uae30\ub2e4\ub9bd\ub2c8\ub2e4.",
      },
      tools: {
        caption: "\ubd07\uc774 \ub85c\uadf8\uc778\ud574 \uc870\uc791\ud560 \uc218 \uc788\ub294 \uc571\ub4e4.",
      },
    },
    roster: {
      eyebrow: "봇 템플릿",
      heading: "봇마다 역할을 주세요",
      copy: "새 봇을 시작하면 인터뷰합니다. 업무, 글쓰기 방식, 작업이 어디에 있는지 몇 가지 질문. 그다음 바로 시작합니다.",
      bots: KO_ROSTER,
    },
    openSource: {
      eyebrow: "오픈소스",
      heading: "가격 페이지 없음. 리포만.",
      copy: "Rakazo는 Apache-2.0 라이선스이며, 당신 머신에서 당신 모델 키로 실행됩니다. 잠긴 기능도, 외부로 연락하는 것도 없습니다.",
      selfHostTitle: "셀프 호스트",
      selfHostMeta: "지금 사용 가능",
      selfHostItems: [
        "Docker 러너와 샌드박스 브라우저",
        "모델 키는 직접 가져오기",
        "루틴, 메모리, 감사 로그",
        "봇 무제한, 시트·한도 없음",
        "GitHub 커뮤니티 지원",
      ],
      starOnGithub: "GitHub에서 Star",
      readTheDocs: "문서 읽기",
      cloudTitle: "Cloud",
      cloudBadge: "곧 출시",
      cloudMeta: "키는 당신 것, 컴퓨터는 우리가 운영",
      cloudItems: [
        "상시 가동 관리형 샌드박스",
        "키와 모델 비용은 당신 것",
        "같은 봇, 같은 루틴, 마이그레이션 없음",
      ],
      getStarted: "시작하기",
    },
    cta: {
      heading: "첫 봇을 만나보세요",
      copy: "미뤄 두었던 일을 Rakazo에 맡기고, 후속까지 맡기세요.",
      getStarted: "시작하기",
      viewOnGithub: "GitHub에서 보기",
      openSourceValue: "오픈소스",
      selfHostValue: "셀프 호스트",
      stats: [
        { value: "stars", label: "GitHub 스타" },
        { value: "license", label: "라이선스" },
        { value: "openSource", label: "시트·게이트 없음" },
        { value: "selfHost", label: "당신 머신" },
      ],
    },
    getStartedDialog: {
      closeLabel: "시작하기 대화상자 닫기",
      eyebrow: "시작하기",
      title: "어떻게 시작할까요?",
      copy: "당신 머신에서 셀프 호스트하거나, Cloud 대기열에 등록하세요.",
      selfHostNow: "지금 셀프 호스트",
      selfHostHint: "설치 단계는 문서에 있습니다.",
      cloudWaitlist: "Cloud 대기열",
      cloudHint: "호스팅 Rakazo가 곧 옵니다. 이메일을 남겨 주세요.",
      back: "뒤로",
      successTitle: "등록되었습니다.",
      successCopy:
        "호스팅 Rakazo가 준비되면 메일로 알려 드립니다. 오늘 시작하려면 이 페이지의 셀프 호스트 섹션으로 이동하세요.",
      done: "완료",
      viewOnGithub: "GitHub에서 보기",
    },
    waitlist: {
      emailLabel: "이메일 주소",
      placeholder: "you@company.com",
      submit: "계속",
      joining: "등록 중…",
      success: "등록되었습니다.",
      added: "추가됨",
      error: "등록하지 못했습니다. 다시 시도하세요.",
    },
    footer: {
      navLabel: "푸터",
      languagesLabel: "언어",
      links: {
        docs: "문서",
        changelog: "변경 내역",
        about: "소개",
        support: "지원",
        privacy: "개인정보 처리방침",
      },
    },
  },
  zh: {
    title: "Rakazo | 开源 Grok Bot 替代品",
    description:
      "Rakazo 是一个开源 Grok Bot 替代品，用于运行真正干活的持久化 AI 队友。密钥、模型、机器，都归你所有。",
    ogImageAlt: "Rakazo：真正属于你的 AI 队友。密钥、模型、机器，都归你所有。",
    availableLanguage: "Chinese",
    skipToContent: "跳到主要内容",
    starFallback: "加星",
    nav: {
      home: "Rakazo 首页",
      primary: "主导航",
      menu: "菜单",
      product: "产品",
      bots: "Bot",
      selfHost: "自托管",
      openSource: "开源",
      docs: "文档",
      viewOnGithub: "在 GitHub 上查看",
    },
    hero: {
      badge: "Apache-2.0",
      pill: "自托管",
      heading: "真正属于你的 AI 队友",
      lead: "把你一直拖着没做的事交给 Bot。它会登录你的工具，趁你睡觉时把活干完，只在需要你做决定时才回来。Rakazo 是开源的 Grok Bot 替代品——你的密钥，你的模型，你的机器。",
      getStarted: "开始使用",
      viewOnGithub: "在 GitHub 上查看",
      setupWithAgent: "用你的智能体安装",
      copiedForAgent: "已为你的智能体复制",
      copyFailed: "复制失败。请重试。",
    },
    selfHost: {
      eyebrow: "自托管",
      heading: "电脑归你所有",
      copy: "在你自己的机器上运行 Rakazo。密钥、模型、数据，都归你所有。",
      features: [
        {
          title: "\u4e0d\u88ab\u5355\u4e00\u6a21\u578b\u7ed1\u5b9a",
          body: "\u6bcf\u4e2a Bot \u90fd\u53ef\u4ee5\u6307\u5411 Claude\u3001GPT\u3001Grok \u6216\u4f60\u81ea\u5df1\u673a\u5668\u4e0a\u7684\u6a21\u578b\u3002\u4fbf\u5b9c\u7684\u8d1f\u8d23\u5206\u6d41\uff0c\u806a\u660e\u7684\u8d1f\u8d23\u6267\u7b14\uff0c\u8d39\u7528\u76f4\u4ed8\u7ed9\u4f9b\u5e94\u5546\u3002",
        },
        {
          title: "\u6559\u4e00\u6b21\uff0c\u5929\u5929\u81ea\u52a8\u8dd1",
          body: "\u628a\u4e00\u4ef6\u4e8b\u6f14\u793a\u4e00\u904d\uff0cBot \u5c31\u628a\u5b83\u5b58\u6210\u666e\u901a\u7684 Markdown \u4f8b\u884c\u2014\u2014\u4e00\u4efd\u4f60\u80fd\u8bfb\u3001\u80fd\u6539\u3001\u80fd\u63d0\u4ea4\u7684\u6587\u4ef6\u3002",
        },
        {
          title: "\u5728\u95ef\u7978\u4e4b\u524d\u5148\u505c\u4e0b",
          body: "\u54ea\u4e9b\u4e8b\u81ea\u5df1\u505a\u3001\u54ea\u4e9b\u4e8b\u5fc5\u987b\u5148\u95ee\uff0c\u7531\u4f60\u8bf4\u4e86\u7b97\u3002\u6bcf\u4e00\u6b65\u90fd\u8bb0\u5728\u4f60\u81ea\u5df1\u673a\u5668\u7684\u5ba1\u8ba1\u65e5\u5fd7\u91cc\u3002",
        },
      ],
    },
    tools: {
      eyebrow: "\u5df2\u8fde\u63a5",
      heading: "\u5b83\u5728\u4f60\u5de5\u4f5c\u7684\u5730\u65b9\u5e72\u6d3b",
      copy: "Bot \u4f1a\u767b\u5f55\u4f60\u672c\u6765\u5c31\u5728\u4ed8\u8d39\u7684\u5de5\u5177\uff0c\u50cf\u4f60\u4e00\u6837\u53bb\u7528\u2014\u2014\u771f\u5b9e\u6d4f\u89c8\u5668\u91cc\u7684\u771f\u5b9e\u4f1a\u8bdd\uff0c\u800c\u4e0d\u662f\u4e00\u5806\u6613\u788e\u7684 API \u80f6\u6c34\u3002",
    },
    illustrations: {
      models: {
        caption: "\u516d\u5bb6\u6a21\u578b\u4f9b\u5e94\u5546\u8fde\u5230\u4f60\u81ea\u5df1\u8fd0\u884c\u7684\u4e00\u4e2a Rakazo \u5b9e\u4f8b\u3002",
      },
      routines: {
        rows: [
          { title: "\u6574\u7406\u6536\u4ef6\u7bb1", range: "\u6bcf\u4e2a\u5de5\u4f5c\u65e5 \u00b7 07:00" },
          { title: "\u8c03\u7814\u65b0\u5ba2\u6237", range: "\u6bcf\u665a \u00b7 02:00" },
          { title: "\u76ef\u4f4f\u6295\u653e\u82b1\u8d39", range: "\u6bcf\u5929 \u00b7 09:00" },
        ],
        dayLabels: ["\u4e00", "\u4e8c", "\u4e09", "\u56db", "\u4e94", "\u516d", "\u65e5"],
        nowLabel: "\u73b0\u5728",
        caption: "\u4e09\u4e2a\u4f8b\u884c\u4efb\u52a1\u8de8\u8d8a\u4e00\u5468\u8fd0\u884c\uff0c\u5e76\u6807\u51fa\u5f53\u524d\u65f6\u95f4\u3002",
      },
      approvals: {
        items: [
          { label: "\u5f52\u6863 214 \u5c01\u5468\u62a5" },
          { label: "\u56de\u590d 6 \u4e2a\u4f8b\u884c\u4f1a\u8bdd" },
          { label: "\u5b89\u6392\u5468\u4e8c\u7ad9\u4f1a" },
          { label: "\u5411 Northwind \u9000\u6b3e $2,400", asks: true },
          { label: "\u53d1\u9001\u5df2\u7b7e\u7f72\u7684\u5408\u540c", asks: true },
        ],
        doneLabel: "\u5df2\u5b8c\u6210",
        asksLabel: "\u5f85\u4f60\u786e\u8ba4",
        caption: "\u4f8b\u884c\u64cd\u4f5c\u81ea\u5df1\u5b8c\u6210\uff1b\u6709\u540e\u679c\u7684\u64cd\u4f5c\u7b49\u4f60\u6279\u51c6\u3002",
      },
      tools: {
        caption: "\u4e00\u9762\u5e94\u7528\u5899\uff0cBot \u53ef\u4ee5\u767b\u5f55\u5e76\u64cd\u4f5c\u5b83\u4eec\u3002",
      },
    },
    roster: {
      eyebrow: "Bot 模板",
      heading: "给每个 Bot 分配一份工作",
      copy: "新建一个 Bot，它会先面试你：几个关于工作内容、写作风格和运行位置的问题。然后它就开始干活。",
      bots: ZH_ROSTER,
    },
    openSource: {
      eyebrow: "开源",
      heading: "没有定价页，只有代码仓库。",
      copy: "Rakazo 采用 Apache-2.0 许可证，在你自己的机器上用你自己的模型密钥运行。没有功能墙，也不会偷偷外联。",
      selfHostTitle: "自托管",
      selfHostMeta: "现已可用",
      selfHostItems: [
        "Docker 运行器和沙箱浏览器",
        "自带模型密钥",
        "例行任务、记忆和审计日志",
        "Bot 数量不限，无席位、无额度限制",
        "GitHub 社区支持",
      ],
      starOnGithub: "在 GitHub 上点星",
      readTheDocs: "阅读文档",
      cloudTitle: "云端",
      cloudBadge: "即将推出",
      cloudMeta: "密钥归你，电脑由我们运行",
      cloudItems: [
        "托管沙箱，始终在线",
        "密钥归你，模型费用归你",
        "同样的 Bot 和例行任务，无需迁移",
      ],
      getStarted: "开始使用",
    },
    cta: {
      heading: "认识你的第一个 Bot",
      copy: "把一件你一直拖延的事交给 Rakazo，让它负责跟进到底。",
      getStarted: "开始使用",
      viewOnGithub: "在 GitHub 上查看",
      openSourceValue: "开源",
      selfHostValue: "自托管",
      stats: [
        { value: "stars", label: "GitHub 星标" },
        { value: "license", label: "许可证" },
        { value: "openSource", label: "无席位、无门槛" },
        { value: "selfHost", label: "你的机器" },
      ],
    },
    getStartedDialog: {
      closeLabel: "关闭开始使用对话框",
      eyebrow: "开始使用",
      title: "你想如何开始？",
      copy: "在你的机器上自托管，或加入云端候补名单。",
      selfHostNow: "立即自托管",
      selfHostHint: "安装步骤见文档。",
      cloudWaitlist: "云端候补名单",
      cloudHint: "托管版 Rakazo 即将推出。留下你的邮箱。",
      back: "返回",
      successTitle: "登记成功。",
      successCopy:
        "托管版 Rakazo 就绪时我们会邮件通知你。想今天就上手？跳到本页的自托管部分。",
      done: "完成",
      viewOnGithub: "在 GitHub 上查看",
    },
    waitlist: {
      emailLabel: "邮箱地址",
      placeholder: "you@company.com",
      submit: "继续",
      joining: "正在登记…",
      success: "登记成功。",
      added: "已添加",
      error: "未能添加你，请重试。",
    },
    footer: {
      navLabel: "页脚",
      languagesLabel: "语言",
      links: {
        docs: "文档",
        changelog: "更新日志",
        about: "关于",
        support: "支持",
        privacy: "隐私",
      },
    },
  },
};

export function getHomeCopy(locale: Locale): HomeCopy {
  return HOME_COPY[locale];
}
