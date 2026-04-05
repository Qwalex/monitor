/**
 * Load .env before other modules read process.env.
 * 1) .env в корне проекта (родитель каталога со входным скриптом: dist/ или src/).
 * 2) .env из текущего рабочего каталога (override).
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const mainScript = process.argv[1];
const fromAppRoot = mainScript
    ? path.join(path.dirname(path.resolve(mainScript)), '..', '.env')
    : null;

if (fromAppRoot && fs.existsSync(fromAppRoot)) {
    dotenv.config({ path: fromAppRoot });
}

const fromCwd = path.join(process.cwd(), '.env');
if (fs.existsSync(fromCwd)) {
    dotenv.config({ path: fromCwd, override: true });
} else if (!fromAppRoot || !fs.existsSync(fromAppRoot)) {
    dotenv.config();
}
