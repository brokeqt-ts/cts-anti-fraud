import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

/** Map route prefix to OpenAPI tag. */
const PREFIX_TAG_MAP: Record<string, string> = {
  '/auth': 'Auth',
  '/accounts': 'Accounts',
  '/bans': 'Bans',
  '/domains': 'Domains',
  '/analytics': 'Analytics',
  '/assessment': 'Assessment',
  '/ai': 'AI',
  '/ml': 'ML',
  '/notifications': 'Notifications',
  '/tags': 'Tags',
  '/admin': 'Admin',
  '/search': 'Search',
  '/collect': 'Collect',
  '/cts': 'CTS',
  '/telegram': 'Telegram',
  '/best-practices': 'Best Practices',
  '/extension': 'Extension',
  '/health': 'Health',
  '/stats': 'Stats',
};

function inferTag(url: string): string {
  // Strip /api/v1 prefix if present
  const path = url.replace(/^\/api\/v1/, '');
  for (const [prefix, tag] of Object.entries(PREFIX_TAG_MAP)) {
    if (path.startsWith(prefix)) return tag;
  }
  return 'Other';
}

export async function registerSwagger(fastify: FastifyInstance): Promise<void> {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'CTS Anti-Fraud API',
        description: `API для внутренней антифрод-платформы Google Ads.

Платформа мониторит аккаунты Google Ads, прогнозирует баны и предоставляет аналитику для команды медиабаинга.

## Аутентификация

Два метода:
- **Bearer JWT** — для dashboard (\`Authorization: Bearer <token>\`)
- **API Key** — для Chrome Extension (\`X-API-Key: <key>\`)

## Роли
- **admin** — полный доступ ко всем аккаунтам и настройкам
- **buyer** — доступ только к своим аккаунтам

## Основные разделы

| Раздел | Описание |
|--------|----------|
| Accounts | CRUD аккаунтов, теги, health score |
| Bans | Журнал банов, post-mortem, auto-detection |
| Analytics | Heatmap, spend velocity, ban chain, trends |
| Assessment | Оценка рисков (14 правил, 5 факторов) |
| AI | Анализ аккаунтов, чат, сравнение моделей |
| ML | Прогнозы бана, обучение, фичи |
| Notifications | SSE стрим, inbox, Telegram |`,
        version: '1.0.0',
        contact: {
          name: 'CTS Team',
        },
      },
      servers: [
        { url: '/api/v1', description: 'API v1' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token from /auth/login',
          },
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            description: 'API key for Chrome Extension',
          },
        },
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      tags: [
        { name: 'Health', description: 'Health check' },
        { name: 'Auth', description: 'Аутентификация: login, refresh, logout, смена пароля' },
        { name: 'Accounts', description: 'Аккаунты Google Ads: список, детали, обновление' },
        { name: 'Bans', description: 'Журнал банов, post-mortem анализ' },
        { name: 'Domains', description: 'Домены: анализ контента, enrichment, scoring' },
        { name: 'Analytics', description: 'Аналитика: heatmap, spend velocity, ban chain, creative decay' },
        { name: 'Assessment', description: 'Оценка рисков аккаунта (rules engine)' },
        { name: 'AI', description: 'AI анализ, чат по аккаунту, сравнение моделей, specialized prompts' },
        { name: 'ML', description: 'ML прогнозы бана, обучение модели, feature importance' },
        { name: 'Notifications', description: 'Уведомления: inbox, SSE стрим, настройки' },
        { name: 'Tags', description: 'Теги и группировка аккаунтов' },
        { name: 'Admin', description: 'Админ: пользователи, настройки, аудит лог' },
        { name: 'Search', description: 'Глобальный поиск по аккаунтам, доменам, банам' },
        { name: 'Collect', description: 'Сбор данных от Chrome Extension' },
        { name: 'Stats', description: 'Статистика: overview, activity, buyer performance' },
        { name: 'CTS', description: 'CTS трекер: сайты, трафик, синхронизация' },
        { name: 'Telegram', description: 'Telegram бот: статус, подключение' },
        { name: 'Best Practices', description: 'Методички команды: CRUD' },
        { name: 'Extension', description: 'Chrome Extension: скачивание, обновление' },
      ],
    },
    transform: ({ schema, url, ...rest }) => {
      // Auto-assign tags based on URL prefix if not already set
      const existingTags = (schema as Record<string, unknown>)?.['tags'] as string[] | undefined;
      const tags = existingTags && existingTags.length > 0
        ? existingTags
        : [inferTag(url)];

      return {
        schema: { ...schema, tags },
        url,
        ...rest,
      };
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      syntaxHighlight: {
        activate: true,
        theme: 'monokai',
      },
    },
    staticCSP: true,
  });
}
