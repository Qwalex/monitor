# Bybit Balance Monitor

Сервис для мониторинга балансов нескольких учетных записей Bybit с веб-интерфейсом и Telegram ботом.

## Возможности

- Добавление нескольких аккаунтов Bybit по API ключам
- Отображение текущих балансов всех аккаунтов
- История изменения балансов (сохраняется каждый час)
- График изменения общего баланса
- Telegram бот для получения информации

## Установка

```bash
npm install
```

## Настройка

Скопируйте `.env.example` в `.env` и заполните:

```env
PORT=3000
DATABASE_PATH=./data/monitor.db
TELEGRAM_BOT_TOKEN=ваш_токен_бота
TELEGRAM_CHAT_ID=ваш_chat_id
```

### Получение Telegram токена бота

1. Откройте @BotFather в Telegram
2. Отправьте /newbot
3. Следуйте инструкциям, получите токен

### Получение Chat ID

1. Откройте @userinfobot в Telegram
2. Отправьте /start
3. Скопируйте ваш ID

## Запуск

```bash
# Режим разработки
npm run dev

# Продакшн
npm run build
npm start
```

## Использование

### Веб-интерфейс

Откройте http://localhost:3000 в браузере.

- **Балансы** - текущие балансы всех аккаунтов
- **График** - визуализация изменения баланса
- **История** - таблица с историей изменений

### Telegram бот

Команды:
- `/start` - приветствие и помощь
- `/accounts` - список аккаунтов и балансы
- `/balance` - текущие балансы
- `/history` - история за 24ч
- `/sync` - синхронизировать балансы

## API Endpoints

- `GET /api/accounts` - список аккаунтов
- `POST /api/accounts` - добавить аккаунт
- `DELETE /api/accounts/:id` - удалить аккаунт
- `GET /api/balances` - текущие балансы
- `POST /api/balances/sync/:accountId` - синхронизировать баланс
- `GET /api/history/all` - история изменений
- `GET /api/history/chart` - данные для графика

## Структура проекта

```
monitor/
├── src/
│   ├── index.ts          # Точка входа
│   ├── database.ts       # SQLite
│   ├── bybit.ts          # Bybit API клиент
│   ├── services.ts       # Мониторинг сервисов
│   ├── routes/           # API эндпоинты
│   ├── bot/telegram.ts   # Telegram бот
│   ├── scheduler.ts      # Cron задачи
│   └── ui/               # HTML/CSS/JS
├── data/                 # База данных SQLite
├── Dockerfile            # Docker образ
├── docker-compose.yml    # Docker Compose
└── .github/workflows/    # CI/CD
```

## Docker

### Локальный запуск

```bash
docker-compose up -d
```

### Деплой на сервер

1. Настрой secrets в GitHub:
   - `GHCR_PULL_TOKEN` - токен для GitHub Container Registry
   - `GHCR_USERNAME` - username GitHub
   - `VPS_HOST` - IP сервера
   - `VPS_PORT` - SSH порт
   - `VPS_USER` - пользователь
   - `VPS_SSH_KEY` - приватный SSH ключ
   - `SKIP_GIT` - коммит с этим текстом пропустит деплой

2. Пуш в master запускает автоматический деплой:
   - Шаг 1: Сборка образа и пуш в GHCR
   - Шаг 2: Pull образа на сервере и перезапуск (минимальный downtime)