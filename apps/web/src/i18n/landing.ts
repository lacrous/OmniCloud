const en = {
  meta: { dir: "ltr" as "ltr" | "rtl", skip: "Skip to content" },
  seo: {
    title: "OmniCloud — Self-hosted cloud storage for your Telegram",
    description:
      "Self-hosted cloud storage powered by your Telegram account. Organize, search, and encrypt your files with an open-source drive you control.",
  },
  nav: {
    features: "Features",
    security: "Security",
    openSource: "Open source",
    signIn: "Sign in",
    getStarted: "Get started",
  },
  hero: {
    badge: "YOUR FILES. YOUR TELEGRAM.",
    titleA: "A calmer home",
    titleB: "for your files.",
    subtitle:
      "Self-hosted cloud storage backed by a private Telegram channel you control. Organize, search, encrypt, and reach your files from one beautifully simple place — with an open API underneath.",
    cta: "Start with your Telegram",
    secondary: "View source",
    trust: ["Open source · MIT", "Runs on your own machine", "Opt-in client-side encryption"],
  },
  mock: {
    allFiles: "All files",
    encrypted: "ENCRYPTED",
    storage: "Storage",
    storageUsed: "3.1 GB of 15 GB",
  },
  features: {
    kicker: "EVERYTHING INCLUDED",
    title: "A full drive, not a demo.",
    subtitle:
      "Everything you expect from a serious file manager, plus the parts nobody else gives you: your own storage backend and an open protocol underneath.",
    items: [
      {
        title: "Backed by your Telegram",
        body: "Files live as documents in a private Telegram channel you control — your account is the storage backend. No third-party cloud vendor.",
      },
      {
        title: "Organize without friction",
        body: "Folders, search, starred items, a Recent view, and a full Trash with restore keep a large drive calm and navigable.",
      },
      {
        title: "Every version kept",
        body: "Replacing a file never destroys the old one. Full version history with one-click restore of any earlier version.",
      },
      {
        title: "Client-side encryption",
        body: "Opt-in experimental end-to-end encryption: files are encrypted in your browser with keys that never leave your device.",
      },
      {
        title: "API, SDK & CLI",
        body: "A typed REST API, an npm SDK, and a command-line interface. Script your uploads, wire it into pipelines, build on top.",
      },
      {
        title: "Hardened by default",
        body: "HttpOnly sessions, sealed Telegram credentials, strict validation, integrity checks, and a public security policy.",
      },
    ],
  },
  steps: {
    kicker: "HOW IT WORKS",
    title: "Three minutes, start to finish.",
    items: [
      {
        title: "Connect Telegram",
        body: "Sign in with Telegram's official flow — QR code or phone number. OmniCloud opens a private storage channel for you.",
      },
      {
        title: "Upload from anywhere",
        body: "Drag, drop, or push via the API. Files stream to your channel with resumable, idempotent uploads that never duplicate.",
      },
      {
        title: "Organize & find",
        body: "Folders, search, versions, and trash in a fast, focused interface. Self-host it all on your own machine.",
      },
    ],
  },
  security: {
    kicker: "SECURITY",
    title: "Honest about what protects you.",
    subtitle:
      "No “unhackable” claims — just a clear model you can read, audit, and run yourself. The full design is documented in the repository.",
    link: "Read the security policy",
    items: [
      "Opt-in client-side encryption: files are encrypted in your browser with keys that never leave your device. Experimental and clearly labeled.",
      "Telegram sign-in uses the official login flow; your MTProto session is sealed at rest and never reaches the browser.",
      "Plain (unencrypted) files are readable by Telegram by design — the channel is yours, and the docs say exactly where the boundary is.",
      "Open source under MIT: every line, every dependency, every migration is public and self-hostable.",
    ],
  },
  openSource: {
    kicker: "OPEN SOURCE & SELF-HOSTED",
    titleA: "Yours to run,",
    titleB: "yours to inspect.",
    subtitle:
      "One Docker Compose file, a Telegram account, and you have a private cloud. The npm SDK and CLI come from the same repository — script it, fork it, make it yours.",
    github: "github.com/Hilbras/OmniCloud",
    npm: "npm package",
    note: "Node.js ≥ 20 · Docker · PostgreSQL — or install straight from npm.",
  },
  cta: {
    title: "Bring your files home.",
    subtitle: "Free, open source, and running on your own machine in minutes.",
    button: "Get started with Telegram",
  },
  footer: {
    features: "Features",
    security: "Security",
    github: "GitHub",
    signIn: "Sign in",
    license: "MIT licensed · Self-hosted",
  },
  langSwitcher: { label: "Language", en: "English", ar: "العربية", ru: "Русский" },
};

export type Translation = typeof en;

const ar: Translation = {
  meta: { dir: "rtl", skip: "تخطَّ إلى المحتوى" },
  seo: {
    title: "OmniCloud — تخزين سحابي مستضاف ذاتيًا لحساب تيليغرام",
    description:
      "تخزين سحابي مستضاف ذاتيًا مدعوم بحساب تيليغرام. رتّب وابحث وشفّر ملفاتك بقرص مفتوح المصدر تتحكم به.",
  },
  nav: {
    features: "المزايا",
    security: "الأمان",
    openSource: "المصدر المفتوح",
    signIn: "تسجيل الدخول",
    getStarted: "ابدأ الآن",
  },
  hero: {
    badge: "ملفاتك. تيليغرامك.",
    titleA: "مسكنٌ أكثر هدوءًا",
    titleB: "لملفاتك.",
    subtitle:
      "تخزين سحابي مستضاف ذاتيًا مدعوم بقناة تيليغرام خاصة تتحكم بها أنت. رتّب وابحث وشفّر وصل إلى ملفاتك من مكان واحد بسيط وجميل — مع واجهة برمجية مفتوحة تحت السطح.",
    cta: "ابدأ مع تيليغرام",
    secondary: "عرض الكود",
    trust: ["مفتوح المصدر · MIT", "يعمل على جهازك", "تشفير اختياري على جانب العميل"],
  },
  mock: {
    allFiles: "كل الملفات",
    encrypted: "مُشفَّر",
    storage: "التخزين",
    storageUsed: "3.1 غيغابايت من 15 غيغابايت",
  },
  features: {
    kicker: "كل المزايا مضمّنة",
    title: "قرص كامل، لا مجرد عرض.",
    subtitle:
      "كل ما تتوقعه من مدير ملفات جادّ، إضافةً إلى ما لا يمنحك أحد آخر: مساحة تخزين خاصة بك وبروتوكول مفتوح تحت السطح.",
    items: [
      {
        title: "مخزَّن على تيليغرام الخاص بك",
        body: "الملفات تُحفظ مستندات داخل قناة تيليغرام خاصة تتحكم بها أنت — حسابك هو مساحة التخزين. لا مزوّد سحابي طرف ثالث.",
      },
      {
        title: "تنظيم بلا عناء",
        body: "مجلدات وبحث وعناصر مميزة وعرض «الأخيرة» وسلة مهملات كاملة مع الاسترجاع، تُبقي حتى المكتبات الكبيرة هادئة وسهلة التصفّح.",
      },
      {
        title: "كل نسخة محفوظة",
        body: "استبدال الملف لا يدمّر النسخة القديمة. سجلّ كامل للإصدارات مع استرجاع أي نسخة سابقة بنقرة واحدة.",
      },
      {
        title: "تشفير على جانب العميل",
        body: "تشفير تجريبي اختياري من طرف إلى طرف: تُشفَّر الملفات في متصفحك بمفاتيح لا تغادر جهازك أبدًا.",
      },
      {
        title: "واجهة برمجية وحزمة وأداة CLI",
        body: "واجهة REST مُحكمة الأنواع، وحزمة npm، وواجهة سطر أوامر. رتّب رفعك برمجيًا، واربطها بخطوط الأنابيب، وابنِ فوقها.",
      },
      {
        title: "حماية افتراضية صارمة",
        body: "جلسات HttpOnly، وبيانات اعتماد تيليغرام مختومة، وتحقق صارم من المدخلات، وفحوصات سلامة، وسياسة أمان عامة.",
      },
    ],
  },
  steps: {
    kicker: "كيف يعمل",
    title: "ثلاث دقائق من البداية إلى النهاية.",
    items: [
      {
        title: "اربط تيليغرام",
        body: "سجّل الدخول عبر تدفّق تيليغرام الرسمي — رمز QR أو رقم الهاتف. يفتح لك OmniCloud قناة تخزين خاصة.",
      },
      {
        title: "ارفع من أي مكان",
        body: "اسحب وأفلت أو ارفع عبر الواجهة البرمجية. تتدفّق الملفات إلى قناتك بعمليات رفع قابلة للاستئناف لا تُكرَّر أبدًا.",
      },
      {
        title: "رتّب واعثر على ملفاتك",
        body: "مجلدات وبحث وإصدارات ومهملات في واجهة سريعة ومركّزة. وكل ذلك مستضاف على جهازك.",
      },
    ],
  },
  security: {
    kicker: "الأمان",
    title: "نصف بصدق ما يحميك.",
    subtitle:
      "بلا ادّعاءات بعدم قابلية الاختراق — فقط نموذج واضح تستطيع قراءته وتدقيقه وتشغيله بنفسك. التصميم الكامل موثّق في المستودع.",
    link: "اقرأ سياسة الأمان",
    items: [
      "تشفير اختياري على جانب العميل: تُشفَّر الملفات في متصفحك بمفاتيح لا تغادر جهازك. تجريبي ومعلَن بوضوح.",
      "تسجيل الدخول عبر تيليغرام يتم بالتدفّق الرسمي؛ جلسة MTProto مختومة ولا تصل المتصفح أبدًا.",
      "الملفات العادية (غير المشفّرة) مقروءة لتيليغرام بطبيعتها — القناة ملكك، والتوثيق يحدّد حدود هذا بوضوح.",
      "مفتوح المصدر برخصة MIT: كل سطر وكل اعتماد وكل ترحيل عام وقابل للتشغيل الذاتي.",
    ],
  },
  openSource: {
    kicker: "مفتوح المصدر ومستضاف ذاتيًا",
    titleA: "بين يديك للتشغيل،",
    titleB: "وليكون تحت فحصك.",
    subtitle:
      "ملف Docker Compose واحد وحساب تيليغرام، وتملك سحابة خاصة. حزمة npm وسطر الأوامر من المستودع نفسه — برمِجها، أنشئ نسخة منها، واجعلها ملكك.",
    github: "github.com/Hilbras/OmniCloud",
    npm: "حزمة npm",
    note: "Node.js ≥ 20 · Docker · PostgreSQL — أو ثبّت مباشرة من npm.",
  },
  cta: {
    title: "أعِد ملفاتك إلى بيتها.",
    subtitle: "مجاني، مفتوح المصدر، ويعمل على جهازك الخاص خلال دقائق.",
    button: "ابدأ مع تيليغرام",
  },
  footer: {
    features: "المزايا",
    security: "الأمان",
    github: "GitHub",
    signIn: "تسجيل الدخول",
    license: "مرخّص برخصة MIT · مستضاف ذاتيًا",
  },
  langSwitcher: { label: "اللغة", en: "English", ar: "العربية", ru: "Русский" },
};

const ru: Translation = {
  meta: { dir: "ltr", skip: "Перейти к содержимому" },
  seo: {
    title: "OmniCloud — Облачное хранилище на самохостинге для вашего Telegram",
    description:
      "Облачное хранилище на самохостинге на базе вашего аккаунта Telegram. Организуйте, ищите и шифруйте файлы с открытым исходным кодом.",
  },
  nav: {
    features: "Возможности",
    security: "Безопасность",
    openSource: "Открытый код",
    signIn: "Войти",
    getStarted: "Начать",
  },
  hero: {
    badge: "ВАШИ ФАЙЛЫ. ВАШ TELEGRAM.",
    titleA: "Спокойный дом",
    titleB: "для ваших файлов.",
    subtitle:
      "Облачное хранилище на самохостинге на базе приватного канала Telegram, которым управляете вы. Организуйте, ищите, шифруйте и открывайте файлы в одном удобном месте — с открытым API под капотом.",
    cta: "Начать с Telegram",
    secondary: "Смотреть код",
    trust: [
      "Открытый код · MIT",
      "Работает на вашем устройстве",
      "Опциональное шифрование на клиенте",
    ],
  },
  mock: {
    allFiles: "Все файлы",
    encrypted: "Зашифровано",
    storage: "Хранилище",
    storageUsed: "3,1 ГБ из 15 ГБ",
  },
  features: {
    kicker: "ВСЁ ВКЛЮЧЕНО",
    title: "Полноценный диск, а не демо.",
    subtitle:
      "Всё, что вы ожидаете от серьёзного файлового менеджера, плюс то, что редко дают: собственный бэкенд хранения и открытый протокол под капотом.",
    items: [
      {
        title: "Хранение на вашем Telegram",
        body: "Файлы лежат документами в приватном канале Telegram, которым владеете вы — ваш аккаунт и есть хранилище. Без сторонних облачных провайдеров.",
      },
      {
        title: "Организация без трения",
        body: "Папки, поиск, избранное, раздел «Недавние» и полноценная корзина с восстановлением сохраняют спокойствие даже большой библиотеки.",
      },
      {
        title: "Каждая версия сохраняется",
        body: "Замена файла не уничтожает старый. Полная история версий с восстановлением любой прежней версии в один клик.",
      },
      {
        title: "Шифрование на клиенте",
        body: "Опциональное экспериментальное сквозное шифрование: файлы шифруются в браузере, ключи не покидают ваше устройство.",
      },
      {
        title: "API, SDK и CLI",
        body: "Типизированный REST API, npm SDK и командная строка. Автоматизируйте загрузки, встраивайте в пайплайны, стройте поверх.",
      },
      {
        title: "Защита по умолчанию",
        body: "Сессии HttpOnly, закрытые данные Telegram, строгая валидация, проверки целостности и открытая политика безопасности.",
      },
    ],
  },
  steps: {
    kicker: "КАК ЭТО РАБОТАЕТ",
    title: "Три минуты от старта до финиша.",
    items: [
      {
        title: "Подключите Telegram",
        body: "Войдите через официальный вход Telegram — по QR-коду или номеру телефона. OmniCloud откроет для вас приватный канал хранения.",
      },
      {
        title: "Загружайте откуда угодно",
        body: "Перетаскивайте файлы или отправляйте через API. Загрузки потоковые, возобновляемые и идемпотентные — дубликатов не будет.",
      },
      {
        title: "Организуйте и находите",
        body: "Папки, поиск, версии и корзина в быстром сфокусированном интерфейсе. Всё это работает на вашей собственной машине.",
      },
    ],
  },
  security: {
    kicker: "БЕЗОПАСНОСТЬ",
    title: "Честно о том, что вас защищает.",
    subtitle:
      "Без лозунгов о неуязвимости — только понятная модель, которую можно прочитать, проверить и запустить самостоятельно. Полное описание — в репозитории.",
    link: "Читать политику безопасности",
    items: [
      "Опциональное клиентское шифрование: файлы шифруются в браузере, ключи не покидают устройство. Экспериментальная функция, честно помеченная.",
      "Вход через официальный механизм Telegram; сессия MTProto хранится в запечатанном виде и никогда не попадает в браузер.",
      "Обычные (нешифрованные) файлы читаемы Telegram по построению — канал принадлежит вам, а документация точно описывает границы.",
      "Открытый исходный код под MIT: каждая строка, зависимость и миграция открыты и работают в самохостинге.",
    ],
  },
  openSource: {
    kicker: "ОТКРЫТЫЙ КОД И САМОХОСТИНГ",
    titleA: "Ваше для запуска,",
    titleB: "ваше для проверки.",
    subtitle:
      "Один файл Docker Compose, аккаунт Telegram — и приватное облако у вас. npm SDK и CLI из того же репозитория: автоматизируйте, форкайте, делайте своим.",
    github: "github.com/Hilbras/OmniCloud",
    npm: "npm-пакет",
    note: "Node.js ≥ 20 · Docker · PostgreSQL — или установите напрямую из npm.",
  },
  cta: {
    title: "Верните файлы домой.",
    subtitle: "Бесплатно, открытый исходный код, запускается на вашей машине за минуты.",
    button: "Начать с Telegram",
  },
  footer: {
    features: "Возможности",
    security: "Безопасность",
    github: "GitHub",
    signIn: "Войти",
    license: "Под лицензией MIT · Самохостинг",
  },
  langSwitcher: { label: "Язык", en: "English", ar: "العربية", ru: "Русский" },
};

export const translations = { en, ar, ru };
