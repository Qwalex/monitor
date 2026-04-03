# Bybit Balance Monitor - Спецификация

## 1. Обзор проекта

**Название:** Bybit Balance Monitor  
**Тип:** Веб-приложение + Telegram бот  
**Функционал:** Мониторинг балансов нескольких учетных записей Bybit с историей изменений  
**Целевая аудитория:** Трейдеры с несколькими аккаунтами Bybit

## 2. Технический стек

- **Backend:** Node.js + Express + TypeScript
- **Database:** SQLite (better-sqlite3)
- **Frontend:** HTML + CSS + Vanilla JS (Chart.js для графиков)
- **Telegram Bot:** node-telegram-bot-api
- **API Client:** bybit-api (npm пакет)
- **Scheduling:** node-cron

## 3. Структура базы данных

### Таблица `accounts`
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PRIMARY KEY | ID аккаунта |
| name | TEXT NOT NULL | Название аккаунта |
| api_key | TEXT NOT NULL | API ключ Bybit |
| api_secret | TEXT NOT NULL | Секретный ключ |
| account_type | TEXT DEFAULT 'UNIFIED' | Тип аккаунта (UNIFIED/CONTRACT/SPOT) |
| created_at | DATETIME | Дата добавления |
| is_active | INTEGER DEFAULT 1 | Активен ли аккаунт |

### Таблица `balance_history`
| Поле | Тип | Описание |
|------|-----|----------|
| id | INTEGER PRIMARY KEY | ID записи |
| account_id | INTEGER | ID аккаунта (FK) |
| coin | TEXT | Валюта (USDT, BTC и т.д.) |
| balance | REAL | Баланс |
| recorded_at | DATETIME | Время записи |

## 4. API Endpoints

### Accounts
- `GET /api/accounts` - Список всех аккаунтов
- `POST /api/accounts` - Добавить новый аккаунт
- `DELETE /api/accounts/:id` - Удалить аккаунт
- `POST /api/accounts/:id/sync` - Принудительная синхронизация баланса

### Balances
- `GET /api/balances` - Текущие балансы всех аккаунтов
- `GET /api/balances/:accountId` - Балансы конкретного аккаунта
- `GET /api/history` - История изменений (параметры: accountId, coin, from, to)
- `GET /api/history/chart` - Данные для графика

### Telegram Bot
- `POST /api/telegram/webhook` - Webhook для Telegram

## 5. Функционал веб-интерфейса

### Страница Dashboard
- Таблица с текущими балансами всех аккаунтов
- Колонки: Название аккаунта, USDT, BTC, ETH, другие валюты
- Кнопка добавления нового аккаунта
- Кнопка удаления аккаунта
- Кнопка ручной синхронизации

### График балансов
- Line chart с Chart.js
- Отображает изменение общего баланса (в USDT) по времени
- Возможность выбора периода: 24ч, 7д, 30д, всё время

### История
- Таблица с историей изменений
- Фильтры по аккаунту и валюте

### Настройки
- Поле для API ключа
- Поле для API секрета
- Поле для названия аккаунта
- Тестовая кнопка "Проверить ключ"

## 6. Функционал Telegram бота

### Команды
- `/start` - Приветствие и помощь
- `/accounts` - Список аккаунтов и их балансы
- `/balance` - Текущие балансы всех аккаунтов
- `/addaccount` - Добавить новый аккаунт (пошагово)
- `/deleteaccount` - Удалить аккаунт
- `/history` - Краткая история изменений за последние 24ч

### Уведомления
- Ежечасный автоматический отчет (опционально)
- Оповещение об изменении баланса >5%

## 7. Сбор данных

- **Автоматический:** Каждый час через node-cron
- **Ручной:** Кнопка "Синхронизировать" в интерфейсе
- Записываются все монеты с ненулевым балансом

## 8. UI/UX Дизайн

### Цветовая схема
- **Background:** #0d1117 (тёмный)
- **Card Background:** #161b22
- **Primary:** #58a6ff (синий)
- **Success:** #3fb950 (зеленый)
- **Danger:** #f85149 (красный)
- **Text Primary:** #c9d1d9
- **Text Secondary:** #8b949e
- **Border:** #30363d

### Шрифт
- **Headings:** JetBrains Mono
- **Body:** Inter

### Компоненты
- Карточки с закругленными углами (8px)
- Тени для глубины
- Hover эффекты на кнопках
- Анимация загрузки

## 9. Конфигурация

Переменные окружения (.env):
```
PORT=3000
DATABASE_PATH=./data/monitor.db
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 10. Структура файлов

```
monitor/
├── src/
│   ├── index.ts          # Точка входа
│   ├── database.ts       # SQLite подключение и миграции
│   ├── bybit.ts          # Bybit API клиент
│   ├── routes/
│   │   ├── accounts.ts   # API аккаунтов
│   │   └── balances.ts   # API балансов
│   ├── bot/
│   │   └── telegram.ts   # Telegram бот
│   ├── scheduler.ts      # Cron задачи
│   └── ui/
│       └── static/       # HTML, CSS, JS
├── data/                 # SQLite база
├── package.json
└── tsconfig.json
```