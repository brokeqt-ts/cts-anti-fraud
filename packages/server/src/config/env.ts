import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface EnvConfig {
  DATABASE_URL: string;
  API_KEY: string;
  JWT_SECRET: string;
  ADMIN_PASSWORD: string;
  PORT: number;
  NODE_ENV: string;
  LOG_LEVEL: string;
  ANTHROPIC_API_KEY: string | null;
  OPENAI_API_KEY: string | null;
  GEMINI_API_KEY: string | null;
  TELEGRAM_BOT_TOKEN: string | null;
  TELEGRAM_CHAT_ID: string | null;
  TELEGRAM_ADMIN_CHAT_ID: string | null;
  TELEGRAM_ENABLED: boolean;
  DASHBOARD_URL: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env: EnvConfig = {
  DATABASE_URL: requireEnv('DATABASE_URL'),
  API_KEY: requireEnv('API_KEY'),
  JWT_SECRET: requireEnv('JWT_SECRET'),
  ADMIN_PASSWORD: process.env['ADMIN_PASSWORD'] ?? 'changeme',
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  NODE_ENV: process.env['NODE_ENV'] ?? 'development',
  LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'info',
  ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] ?? null,
  OPENAI_API_KEY: process.env['OPENAI_API_KEY'] ?? null,
  GEMINI_API_KEY: process.env['GEMINI_API_KEY'] ?? null,
  TELEGRAM_BOT_TOKEN: process.env['TELEGRAM_BOT_TOKEN'] ?? null,
  TELEGRAM_CHAT_ID: process.env['TELEGRAM_CHAT_ID'] ?? null,
  TELEGRAM_ADMIN_CHAT_ID: process.env['TELEGRAM_ADMIN_CHAT_ID'] ?? null,
  TELEGRAM_ENABLED: process.env['TELEGRAM_ENABLED'] === 'true',
  DASHBOARD_URL: process.env['DASHBOARD_URL'] ?? 'http://localhost:5173',
};
