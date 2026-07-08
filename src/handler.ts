import { DurableObject } from 'cloudflare:workers';
import { isAdminAuthenticated } from './auth';
import { fixCors } from './core/utils';
import { clearResolveCache, resolveProvider, listModels } from './core/router';
import { ConfigManager } from './durable/config-manager';
import { getAbnormalKeyConfigs } from './pool/key-pool';
import {
	handleApiKeys, handleUpdateApiKey, handleDeleteApiKeys, handleToggleApiKeys, getAllApiKeys,
	handleGetProviders, handleUpsertProvider, handleDeleteProvider,
	handleGetEndpoints, handleUpsertEndpoint, handleDeleteEndpoint,
	handleGetModels, handleUpsertModel, handleDeleteModel,
	handleBackup, handleRestore,
} from './routes/admin';

export class LoadBalancer extends DurableObject {
	env: Env;
	config: ConfigManager;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.env = env;
		this.config = new ConfigManager(this.ctx.storage.sql);

		this.config.initSchema();
	}

	async fetch(request: Request): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: fixCors({}).headers,
			});
		}
		const url = new URL(request.url);
		let pathname = url.pathname;

		if (pathname === '/favicon.ico' || pathname === '/robots.txt') {
			return new Response('', { status: 204 });
		}

		// Admin API
		if (pathname.startsWith('/api/')) {
			if (!isAdminAuthenticated(request, this.env.HOME_ACCESS_KEY)) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: fixCors({ headers: { 'Content-Type': 'application/json' } }).headers,
				});
			}

			// Invalidate resolveProvider cache on write operations
			if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
				clearResolveCache();
			}

			// Keys
			if (pathname === '/api/keys' && request.method === 'POST') return handleApiKeys(request, this.ctx.storage);
			if (pathname === '/api/keys' && request.method === 'PUT') return handleUpdateApiKey(request, this.ctx.storage);
			if (pathname === '/api/keys' && request.method === 'GET') return getAllApiKeys(request, this.ctx.storage.sql);
			if (pathname === '/api/keys' && request.method === 'DELETE') return handleDeleteApiKeys(request, this.ctx.storage);
			if (pathname === '/api/keys' && request.method === 'PATCH') return handleToggleApiKeys(request, this.ctx.storage);

			// Providers
			if (pathname === '/api/providers' && request.method === 'GET') return handleGetProviders(this.ctx.storage.sql);
			if (pathname === '/api/providers' && request.method === 'POST') return handleUpsertProvider(request, this.ctx.storage.sql);
			if (pathname === '/api/providers' && request.method === 'DELETE') return handleDeleteProvider(request, this.ctx.storage);

			// Endpoints
			if (pathname === '/api/endpoints' && request.method === 'GET') return handleGetEndpoints(this.ctx.storage.sql);
			if (pathname === '/api/endpoints' && request.method === 'POST') return handleUpsertEndpoint(request, this.ctx.storage);
			if (pathname === '/api/endpoints' && request.method === 'DELETE') return handleDeleteEndpoint(request, this.ctx.storage.sql);

			// Models
			if (pathname === '/api/models' && request.method === 'GET') return handleGetModels(this.ctx.storage.sql);
			if (pathname === '/api/models' && request.method === 'POST') return handleUpsertModel(request, this.ctx.storage);
			if (pathname === '/api/models' && request.method === 'DELETE') return handleDeleteModel(request, this.ctx.storage);

			// Backup / Restore
			if (pathname === '/api/backup' && request.method === 'GET') return handleBackup(this.ctx.storage.sql);
			if (pathname === '/api/backup/restore' && request.method === 'POST') return handleRestore(request, this.ctx.storage);
		}

		// Internal resolve endpoint (called from Worker)
		if (pathname === '/__resolve') {
			try {
				const body = await request.json() as { endpointId: string; model?: string };
				const rp = await resolveProvider(this.ctx.storage.sql, body.endpointId, body.model);
				return new Response(JSON.stringify({
					providerType: rp.provider.type,
					providerName: rp.providerName,
					baseUrl: rp.baseUrl,
					endpoint: rp.endpoint,
					apiKey: rp.apiKey,
				}), { headers: { 'Content-Type': 'application/json' } });
			} catch (err: any) {
				return new Response(JSON.stringify({ error: err.message }), {
					status: err.status || 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Internal: list all models (called from Worker /v1/models)
		if (pathname === '/__list-models') {
			try {
				const url = new URL(request.url);
				const endpointId = url.searchParams.get('endpointId') || undefined;
				const models = listModels(this.ctx.storage.sql, endpointId);
				return new Response(JSON.stringify({ models }), { headers: { 'Content-Type': 'application/json' } });
			} catch (err: any) {
				return new Response(JSON.stringify({ error: err.message }), {
					status: err.status || 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Internal: get configs for abnormal keys (called from Worker cron)
		if (pathname === '/__resolve-abnormal-keys') {
			try {
				const rows = getAbnormalKeyConfigs(this.ctx.storage.sql);
				return new Response(JSON.stringify({ rows }), { headers: { 'Content-Type': 'application/json' } });
			} catch (err: any) {
				return new Response(JSON.stringify({ error: err.message }), {
					status: err.status || 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Internal: get configs for given keys (called from Worker /api/keys/check)
		if (pathname === '/__resolve-key-configs' && request.method === 'POST') {
			try {
				const { keys } = await request.json() as { keys: string[] };
				const configs: Array<{
					api_key: string; providerType: string; providerName: string;
					baseUrl: string; models: string[];
				}> = [];
				if (keys && keys.length > 0) {
					const batchSize = 500;
					for (let i = 0; i < keys.length; i += batchSize) {
						const batch = keys.slice(i, i + batchSize);
						const ph = batch.map(() => '?').join(',');
						for (const row of this.ctx.storage.sql.exec(`
							SELECT k.api_key, p.type, p.name, p.base_url, GROUP_CONCAT(DISTINCT m.model) as models
							FROM api_keys k
							JOIN key_providers kp ON kp.api_key = k.api_key
							JOIN providers p ON p.id = kp.provider_id
							LEFT JOIN key_models m ON m.api_key = k.api_key
							WHERE p.enabled = 1 AND k.api_key IN (${ph})
							GROUP BY k.api_key, p.type, p.name, p.base_url
						`, ...batch).raw<[string, string, string, string, string | null]>()) {
							configs.push({
								api_key: row[0],
								providerType: row[1],
								providerName: row[2],
								baseUrl: row[3],
								models: row[4] ? row[4].split(',') : [],
							});
						}
					}
				}
				const groups: Array<{ api_key: string; key_group: string }> = [];
				const batchSize = 500;
				for (let i = 0; i < (keys || []).length; i += batchSize) {
					const batch = keys.slice(i, i + batchSize);
					const ph = batch.map(() => '?').join(',');
					for (const r of this.ctx.storage.sql.exec(
						`SELECT api_key, key_group FROM api_keys WHERE api_key IN (${ph})`, ...batch
					).raw<[string, string]>()) {
						groups.push({ api_key: r[0] as string, key_group: r[1] as string });
					}
				}
				return new Response(JSON.stringify({ configs, groups }), { headers: { 'Content-Type': 'application/json' } });
			} catch (err: any) {
				return new Response(JSON.stringify({ error: err.message }), {
					status: err.status || 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// Internal: batch-update key groups (called from Worker)
		if (pathname === '/__batch-update-key-group' && request.method === 'POST') {
			try {
				const { updates } = await request.json() as { updates: Array<{ api_key: string; key_group: string }> };
				// 300 × (2 CASE params + 1 IN param) = 900 < SQLite 默认参数上限(999)
				const batchSize = 300;
				for (let i = 0; i < updates.length; i += batchSize) {
					const batch = updates.slice(i, i + batchSize);
					this.ctx.storage.sql.exec(
						`UPDATE api_keys SET key_group = CASE ${batch.map(() => "WHEN api_key = ? THEN ?").join(' ')} END WHERE api_key IN (${batch.map(() => '?').join(',')})`,
						...batch.flatMap(u => [u.api_key, u.key_group]),
						...batch.map(u => u.api_key)
					);
				}
				clearResolveCache();
				return new Response('ok', { status: 200 });
			} catch (err: any) {
				return new Response(err.message, { status: 500, headers: { 'Content-Type': 'application/json' } });
			}
		}

		return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
	}
}
