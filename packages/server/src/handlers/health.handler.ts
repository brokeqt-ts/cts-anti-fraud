import type { FastifyRequest, FastifyReply } from 'fastify';
import { checkConnection } from '../config/database.js';
import { env } from '../config/env.js';

const startTime = Date.now();
const APP_VERSION = process.env['npm_package_version'] ?? '0.1.0';

export async function healthHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const db = await checkConnection(env.DATABASE_URL);
  const lastReceived = await request.server.collectService.getLastReceived();

  const status = db.connected ? 'ok' : 'degraded';

  await reply.status(200).send({
    status,
    version: APP_VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    database: db,
    last_data_received: lastReceived,
    ai_models: {
      claude: !!env.ANTHROPIC_API_KEY,
      openai: !!env.OPENAI_API_KEY,
      gemini: !!env.GEMINI_API_KEY,
    },
  });
}
