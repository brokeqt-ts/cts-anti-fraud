/**
 * SSE Event Bus — broadcasts events to connected SSE clients.
 *
 * Used for real-time notifications: when a notification is created,
 * the bus pushes it to all connected clients for that user.
 */

import type { FastifyReply } from 'fastify';

interface SseClient {
  userId: string;
  reply: FastifyReply;
}

const clients: Set<SseClient> = new Set();

export function addSseClient(userId: string, reply: FastifyReply): void {
  const client: SseClient = { userId, reply };
  clients.add(client);

  // Remove on disconnect
  reply.raw.on('close', () => {
    clients.delete(client);
  });
}

export function broadcastToUser(userId: string, event: string, data: unknown): void {
  for (const client of clients) {
    if (client.userId === userId) {
      try {
        client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }
}

export function broadcastToAll(event: string, data: unknown): void {
  for (const client of clients) {
    try {
      client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

export function getConnectedCount(): number {
  return clients.size;
}
