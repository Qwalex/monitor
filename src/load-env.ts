/**
 * Загрузка .env до чтения process.env в остальных модулях.
 *
 * Важно: Docker Compose часто делает `VK_ACCESS_TOKEN=${VK_ACCESS_TOKEN}` и подставляет
 * пустую строку — тогда без override: true dotenv не перезапишет значение из файла.
 *
 * Порядок (последний найденный файл перекрывает предыдущие):
 * - MONITOR_DOTENV — явный путь к .env
 * - родитель каталога входного скрипта (корень проекта рядом с dist/ или src/)
 * - process.cwd()/.env
 * - родитель cwd (если запуск из dist/)
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

const mainScript = process.argv[1];
const fromEntryParent = mainScript
    ? path.join(path.dirname(path.resolve(mainScript)), '..', '.env')
    : null;

const candidates: string[] = [];
if (process.env.MONITOR_DOTENV?.trim()) {
    candidates.push(path.resolve(process.env.MONITOR_DOTENV.trim()));
}
if (fromEntryParent) {
    candidates.push(fromEntryParent);
}
candidates.push(path.join(process.cwd(), '.env'));
candidates.push(path.join(process.cwd(), '..', '.env'));

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
    const hint =
        loaded.length > 0
            ? ' Файл .env найден, но VK_ACCESS_TOKEN пустой или отсутствует — проверьте строку в файле (без пробелов в имени ключа).'
            : ' Ни один .env не найден по путям: ' + tried.join(' | ');
    console.log('[monitor] VK_ACCESS_TOKEN не задан после загрузки env.' + hint);
    console.log(
        '[monitor] Можно задать абсолютный путь: MONITOR_DOTENV=/path/to/.env (в systemd Environment= до ExecStart=).'
    );
}
