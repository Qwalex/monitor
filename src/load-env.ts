/**
 * Загрузка .env до чтения process.env в остальных модулях.
 *
 * В Docker переменные обычно приходят из compose `environment:` / `env_file:` — файла
 * /app/.env в контейнере может не быть; это нормально.
 *
 * Порядок файлов (последний перекрывает предыдущие, override: true):
 * - MONITOR_DOTENV
 * - родитель каталога входного скрипта (…/dist/../.env ≈ корень приложения)
 * - каталог входного скрипта (…/dist/.env)
 * - process.cwd()/.env
 * - не добавляем cwd/../.env если это «/.env» у корня ФС
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

function loadOneEnvFile(absPath: string): boolean {
    if (!fs.existsSync(absPath)) return false;
    try {
        dotenv.config({ path: absPath, override: true });
        return true;
    } catch (e) {
        console.error(`[monitor] не удалось прочитать .env: ${absPath}`, e);
        return false;
    }
}

function isFilesystemRootDotenv(absPath: string): boolean {
    const resolved = path.resolve(absPath);
    const root = path.parse(resolved).root;
    return path.dirname(resolved) === root && path.basename(resolved) === '.env';
}

const mainScript = process.argv[1];
const entryDir = mainScript ? path.dirname(path.resolve(mainScript)) : null;
const fromEntryParent = entryDir ? path.join(entryDir, '..', '.env') : null;
const besideEntry = entryDir ? path.join(entryDir, '.env') : null;

const candidates: string[] = [];
if (process.env.MONITOR_DOTENV?.trim()) {
    candidates.push(path.resolve(process.env.MONITOR_DOTENV.trim()));
}
if (fromEntryParent) {
    candidates.push(fromEntryParent);
}
if (besideEntry) {
    candidates.push(besideEntry);
}
candidates.push(path.join(process.cwd(), '.env'));

const parentCwdEnv = path.resolve(process.cwd(), '..', '.env');
if (!isFilesystemRootDotenv(parentCwdEnv)) {
    candidates.push(parentCwdEnv);
}

const tried = [...new Set(candidates)];
const loaded: string[] = [];
for (const p of tried) {
    if (loadOneEnvFile(p)) {
        loaded.push(p);
    }
}

if (loaded.length === 0) {
    dotenv.config({ override: true });
}

const vkTok = process.env.VK_ACCESS_TOKEN?.trim();
if (!vkTok) {
    if (loaded.length > 0) {
        console.log(
            '[monitor] VK_ACCESS_TOKEN не задан: в загруженных .env нет непустого ключа (проверьте имя и значение).'
        );
    } else {
        console.log(
            '[monitor] VK_ACCESS_TOKEN не задан: в контейнере нет файла .env (это нормально). ' +
                'Передайте переменные через docker-compose environment (как TELEGRAM_*) или env_file: .env на хосте.'
        );
        console.log(
            `[monitor] cwd=${process.cwd()} argv[1]=${mainScript ?? ''} проверенные пути: ${tried.join(' | ')}`
        );
    }
    console.log(
        '[monitor] Либо абсолютный путь к файлу на хосте при bind-mount: MONITOR_DOTENV=/app/config/.env'
    );
}
