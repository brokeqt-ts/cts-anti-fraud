import type { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import { getPool } from '../config/database.js';
import { audit } from '../services/audit.service.js';
import { env } from '../config/env.js';

const API_KEY_PLACEHOLDER = '__CTS_API_KEY_PLACEHOLDER__';
const SERVER_URL_PLACEHOLDER = '__CTS_SERVER_URL_PLACEHOLDER__';

function getExtensionDistPath(): string {
  // __dirname in compiled CJS = packages/server/dist/handlers/
  // We need packages/extension/dist/
  return path.resolve(__dirname, '..', '..', '..', 'extension', 'dist');
}

/** Shared logic: look up api_key for a given userId and stream the zip. */
async function streamExtensionZip(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const pool = getPool(env.DATABASE_URL);
  const result = await pool.query(
    'SELECT api_key, name FROM users WHERE id = $1 AND is_active = true',
    [userId],
  );

  const row = result.rows[0] as { api_key?: string; name?: string } | undefined;
  if (!row) {
    await reply.status(404).send({
      error: 'User not found or inactive',
      code: 'USER_NOT_FOUND',
    });
    return;
  }

  const apiKey = row.api_key;
  if (!apiKey) {
    await reply.status(404).send({
      error: 'API key not found for this user. Generate an API key first.',
      code: 'API_KEY_NOT_FOUND',
    });
    return;
  }

  const extDistPath = getExtensionDistPath();
  if (!fs.existsSync(extDistPath)) {
    request.log.error({ path: extDistPath }, 'Extension dist directory not found');
    await reply.status(500).send({
      error: 'Extension template not available',
      code: 'EXTENSION_NOT_BUILT',
    });
    return;
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="cts-extension.zip"',
    'Cache-Control': 'no-store',
  });

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(reply.raw);

  archive.on('error', (err) => {
    request.log.error({ err }, 'Archive error');
    reply.raw.end();
  });

  // Resolve server URL: EXT_SERVER_URL env var → fallback to request origin
  const serverUrl = process.env['EXT_SERVER_URL']
    || `${request.protocol}://${request.hostname}`;

  addDirectoryToArchive(archive, extDistPath, 'cts-extension', apiKey, serverUrl);
  await archive.finalize();
}

/** GET /api/v1/extension/download — authenticated user downloads their own extension. */
export async function downloadExtensionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user?.id;
  if (!userId) {
    await reply.status(401).send({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    return;
  }
  audit(getPool(env.DATABASE_URL), request, 'extension.download', { entityType: 'user', entityId: userId });
  await streamExtensionZip(request, reply, userId);
}

/** GET /api/v1/extension/download/:userId — admin downloads extension for a specific user. */
export async function adminDownloadExtensionHandler(
  request: FastifyRequest<{ Params: { userId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { userId } = request.params;
  await streamExtensionZip(request, reply, userId);
}

function addDirectoryToArchive(
  archive: archiver.Archiver,
  dirPath: string,
  archivePrefix: string,
  apiKey: string,
  serverUrl: string,
): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const archivePath = `${archivePrefix}/${entry.name}`;

    if (entry.isDirectory()) {
      addDirectoryToArchive(archive, fullPath, archivePath, apiKey, serverUrl);
    } else if (entry.name.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const replaced = content
        .replaceAll(API_KEY_PLACEHOLDER, apiKey)
        .replaceAll(SERVER_URL_PLACEHOLDER, serverUrl);
      archive.append(replaced, { name: archivePath });
    } else {
      archive.file(fullPath, { name: archivePath });
    }
  }
}
