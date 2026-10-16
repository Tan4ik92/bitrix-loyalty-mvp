import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDigiftApi, runDigiftMailImport } from '../backend/digift-mail-import.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const apply = process.argv.includes('--apply');
if (process.argv.some((arg) => arg.startsWith('--') && arg !== '--apply')) {
  throw new Error('Поддерживается только необязательный флаг --apply');
}
const api = createDigiftApi({
  mailWebhookUrl: process.env.DIGIFT_BITRIX_MAIL_WEBHOOK_URL,
  crmBaseUrl: process.env.VIBECODE_API_BASE,
  crmApiKey: process.env.VIBECODE_API_KEY,
});
const result = await runDigiftMailImport({ ...api, apply });
console.log(JSON.stringify(result, null, 2));
