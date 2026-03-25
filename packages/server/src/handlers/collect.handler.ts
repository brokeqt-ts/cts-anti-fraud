import type { FastifyRequest, FastifyReply } from 'fastify';
import type { CollectRequest } from '@cts/shared';

export async function collectHandler(
  request: FastifyRequest<{ Body: CollectRequest }>,
  reply: FastifyReply,
): Promise<void> {
  const { profile_id, antidetect_browser, proxy_info, fingerprint_hash, profile_config, batch } = request.body;

  try {
    const userId = request.user?.id !== 'legacy' ? request.user?.id : undefined;
    const processed = await request.server.collectService.processPayload(profile_id, batch, antidetect_browser, proxy_info, fingerprint_hash, profile_config, userId);

    await reply.status(200).send({
      status: 'ok',
      processed,
    });
  } catch (err) {
    request.log.error(err, 'Failed to process collect payload');
    await reply.status(500).send({
      error: 'Internal server error',
      code: 'COLLECT_FAILED',
    });
  }
}
