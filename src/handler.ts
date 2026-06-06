import { DurableObject } from 'cloudflare:workers';
import { isAdminAuthenticated } from './auth';
import { fixCors } from './core/utils';
import { extractEndpointId, stripEndpointPrefix } from './core/router';
import { ConfigManager } from './durable/config-manager';
import { runHealthCheck } from './pool/key-pool';
import { handleOpenAI, handleGeminiProxy } from './routes/proxy';
import { handleAnthropicMessages } from './routes/anthropic';
import {
	handleApiKeys, handleUpdateApiKey, handleDeleteApiKeys, handleToggleApiKeys, handleApiKeysCheck, getAllApiKeys,
	handleGetProviders, handleUpsertProvider, handleDeleteProvider,
	handleGetEndpoints, handleUpsertEndpoint, handleDeleteEndpoint,
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

		this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 60 * 1000);
	}

	async alarm() {
		await runHealthCheck(this.ctx.storage.sql);
		this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 60 * 1000);
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

		// /v1 prefix → default endpoint; /e/:id/ prefix → custom endpoint
		let endpointId: string;
		if (pathname.startsWith('/v1/')) {
			endpointId = 'default';
		} else {
			endpointId = extractEndpointId(pathname) ?? 'default';
			if (endpointId !== 'default') {
				pathname = stripEndpointPrefix(pathname);
			}
		}

		// Admin API
		if (pathname.startsWith('/api/')) {
			if (!isAdminAuthenticated(request, this.env.HOME_ACCESS_KEY)) {
				return new Response(JSON.stringify({ error: 'Unauthorized' }), {
					status: 401,
					headers: fixCors({ headers: { 'Content-Type': 'application/json' } }).headers,
				});
			}

			// Keys
			if (pathname === '/api/keys' && request.method === 'POST') return handleApiKeys(request, this.ctx.storage.sql);
			if (pathname === '/api/keys' && request.method === 'PUT') return handleUpdateApiKey(request, this.ctx.storage.sql);
			if (pathname === '/api/keys' && request.method === 'GET') return getAllApiKeys(request, this.ctx.storage.sql);
			if (pathname === '/api/keys' && request.method === 'DELETE') return handleDeleteApiKeys(request, this.ctx.storage.sql);
			if (pathname === '/api/keys' && request.method === 'PATCH') return handleToggleApiKeys(request, this.ctx.storage.sql);
			if (pathname === '/api/keys/check' && request.method === 'POST') return handleApiKeysCheck(request, this.ctx.storage.sql);

			// Providers
			if (pathname === '/api/providers' && request.method === 'GET') return handleGetProviders(this.ctx.storage.sql);
			if (pathname === '/api/providers' && request.method === 'POST') return handleUpsertProvider(request, this.ctx.storage.sql);
			if (pathname === '/api/providers' && request.method === 'DELETE') return handleDeleteProvider(request, this.ctx.storage.sql);

			// Endpoints
			if (pathname === '/api/endpoints' && request.method === 'GET') return handleGetEndpoints(this.ctx.storage.sql);
			if (pathname === '/api/endpoints' && request.method === 'POST') return handleUpsertEndpoint(request, this.ctx.storage.sql);
			if (pathname === '/api/endpoints' && request.method === 'DELETE') return handleDeleteEndpoint(request, this.ctx.storage.sql);

			// Backup / Restore
			if (pathname === '/api/backup' && request.method === 'GET') return handleBackup(this.ctx.storage.sql);
			if (pathname === '/api/backup/restore' && request.method === 'POST') return handleRestore(request, this.ctx.storage.sql);
		}

		// Anthropic compatible route
		if (pathname.endsWith('/v1/messages')) {
			return handleAnthropicMessages(request, this.env, this.ctx.storage.sql, endpointId);
		}

		// OpenAI compatible routes
		if (
			pathname.endsWith('/chat/completions') ||
			pathname.endsWith('/completions') ||
			pathname.endsWith('/embeddings') ||
			pathname.endsWith('/v1/models')
		) {
			return handleOpenAI(request, this.env, this.ctx.storage.sql, endpointId);
		}

		// Direct Gemini proxy
		return handleGeminiProxy(request, this.env, this.ctx.storage.sql);
	}
}
