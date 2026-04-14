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

Нужна **MongoDB** (локально или в облаке). Пример локально:

```bash
docker run -d -p 27017:27017 --name mongo -v mongo_data:/data/db mongo:7
```

## Настройка

Скопируйте `.env.example` в `.env` и заполните:

```env
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/monitor
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

Откройте <http://localhost:3000> в браузере.

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
- `POST /api/railway/webhook` - приём событий Railway и отправка уведомлений

## Структура проекта

```text
monitor/
├── src/
│   ├── index.ts          # Точка входа
│   ├── database.ts       # MongoDB
│   ├── bybit.ts          # Bybit API клиент
│   ├── services.ts       # Мониторинг сервисов
│   ├── routes/           # API эндпоинты
│   ├── bot/telegram.ts   # Telegram бот
│   ├── scheduler.ts      # Cron задачи
│   └── ui/               # HTML/CSS/JS
├── Dockerfile            # Docker образ
├── docker-compose.yml    # Docker Compose (app + MongoDB)
└── .github/workflows/    # CI/CD
```

## Деплой на Railway

1. Создайте проект в [Railway](https://railway.app), подключите репозиторий.
2. Сервис приложения собирается из корневого `Dockerfile` (см. `railway.toml`). `PORT` подставляет Railway — менять не нужно.
3. В проекте Railway добавьте базу **MongoDB** (New → Database → MongoDB) или подключите внешний кластер.
4. В сервисе приложения откройте **Variables** и задайте строку подключения:
   - удобнее всего добавить **Variable Reference** на `MONGO_URL` / `MONGO_PUBLIC_URL` из плагина MongoDB и при необходимости продублировать её как `MONGODB_URI` (приложение читает `MONGODB_URI` и `MONGO_URL`);
   - либо скопируйте URI из карточки MongoDB в `MONGODB_URI`.
5. Задайте `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` и при необходимости ключи VK (см. `.env.example`).
6. Проверка готовности: `GET /api/health` (если используете `BASE_PATH`, путь будет `${BASE_PATH}/api/health` — тогда поправьте healthcheck в настройках деплоя Railway).

### Webhook уведомления от Railway

Чтобы получать события деплоя/алертов Railway в Telegram (или VK как fallback):

1. Убедитесь, что заданы `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` (или VK переменные fallback).
2. (Рекомендуется) добавьте переменную `RAILWAY_WEBHOOK_TOKEN` в Variables приложения.
3. В Railway откройте **Project Settings → Webhooks** и добавьте URL:
   - без `BASE_PATH`: `https://<ваш-домен>/api/railway/webhook`
   - с `BASE_PATH=/monitor`: `https://<ваш-домен>/monitor/api/railway/webhook`
4. Если используете токен, передайте его в webhook:
   - самый простой способ для Railway: добавьте `?token=<RAILWAY_WEBHOOK_TOKEN>` в URL webhook;
   - например: `https://<ваш-домен>/api/railway/webhook?token=<RAILWAY_WEBHOOK_TOKEN>`
   - также поддерживаются заголовки (если отправитель умеет их задавать):
   - `Authorization: Bearer <RAILWAY_WEBHOOK_TOKEN>`
   - или `x-railway-token: <RAILWAY_WEBHOOK_TOKEN>`

После этого события Railway будут пересылаться в мессенджер.

## Docker

### Локальный запуск

```bash
docker-compose up -d
```

В `docker-compose.yml` поднимаются контейнеры **mongo** и **monitor**; приложение получает `MONGODB_URI=mongodb://mongo:27017/monitor`.

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

На сервере задайте `MONGODB_URI` на ваш MongoDB (отдельный контейнер, Atlas и т.д.).
