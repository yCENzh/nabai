import { Hono } from 'hono';
import { Render } from './render';
import { LoadBalancer } from './handler';
import { getAuthKey } from './auth';
import { getCookie, setCookie } from 'hono/cookie';
import { extractEndpointId, stripEndpointPrefix, buildProvider } from './core/router';
import { handleOpenAI } from './routes/proxy';
import { handleAnthropicMessages } from './routes/anthropic';
import { fixCors, maskKey, BASE_URL } from './core/utils';
import { healthCheckKey } from './pool/key-pool';

const app = new Hono<{ Bindings: Env }>();

function getDOStub(c: { env: Env }): DurableObjectStub {
	const id: DurableObjectId = c.env.LOAD_BALANCER.idFromName('loadbalancer');
	return c.env.LOAD_BALANCER.get(id, { locationHint: 'wnam' });
}

async function resolveConfig(stub: DurableObjectStub, endpointId: string, model?: string): Promise<{ data: {
	providerType: string; providerName: string; baseUrl: string;
	endpoint: { id: string; enabled: boolean } | null;
	apiKey?: string; error?: string;
}; status: number }> {
	const resp = await stub.fetch(new Request('http://do/__resolve', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpointId, model }),
	}));
	const data = await resp.json() as {
		providerType: string; providerName: string; baseUrl: string;
		endpoint: { id: string; enabled: boolean } | null;
		apiKey?: string; error?: string;
	};
	return { data, status: resp.status };
}

/**
 * 解析 endpoint 配置 + 认证校验。
 * 成功返回 API key 与 provider 信息，失败返回错误 Response。
 */
async function resolveConfigAndAuth(
	stub: DurableObjectStub, endpointId: string, model: string | undefined,
	env: { AUTH_KEY: string }, clientKey: string | null
): Promise<Response | { providerType: string; providerName: string; baseUrl: string; apiKey: string }> {
	const { data: cfg, status: resolveStatus } = await resolveConfig(stub, endpointId, model);
	if (cfg.error) {
		return new Response(JSON.stringify({ error: cfg.error }), {
			status: resolveStatus,
			headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
		});
	}

	if (clientKey !== env.AUTH_KEY) {
		return new Response('Unauthorized', { status: 401, headers: fixCors({}).headers });
	}
	if (!cfg.apiKey) {
		return new Response(JSON.stringify({ error: 'No API keys configured for this endpoint.' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
		});
	}
	return { providerType: cfg.providerType, providerName: cfg.providerName, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey };
}


app.get('/', (c) => {
	const sessionKey = getCookie(c, 'auth-key');
	const authKey = getAuthKey(c.req.raw, sessionKey);
	if (authKey !== c.env.HOME_ACCESS_KEY) {
		return c.html(Render({ isAuthenticated: false, showWarning: false }));
	}
	const showWarning =
		c.env.HOME_ACCESS_KEY === '08579ef49716b41562fbfe0b7e15d968cd816421604ee58fb706033ebde4ac14' || c.env.AUTH_KEY === 'nabai';
	return c.html(Render({ isAuthenticated: true, showWarning }));
});

app.post('/', async (c) => {
	const { key } = await c.req.json();
	if (key === c.env.HOME_ACCESS_KEY) {
		setCookie(c, 'auth-key', key, { maxAge: 60 * 60 * 24 * 30, path: '/', httpOnly: true, secure: true, sameSite: 'Strict' });
		return c.json({ success: true });
	}
	return c.json({ success: false }, 401);
});

app.get('/favicon.ico', async (c) => {
	return c.text('Not found', 404);
});

app.all('*', async (c) => {
	// OPTIONS preflight
	if (c.req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: fixCors({}).headers });
	}

	const url = new URL(c.req.raw.url);
	let pathname = url.pathname;

	// POST /api/keys/check — handled in Worker (no upstream HTTP from DO)
	if (pathname === '/api/keys/check' && c.req.method === 'POST') {
		const userKey = getAuthKey(c.req.raw);
		if (userKey !== c.env.HOME_ACCESS_KEY) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}
		let keys: string[];
		try {
			({ keys } = await c.req.json() as { keys: string[] });
		} catch {
			return new Response(JSON.stringify({ error: '请求体无效，无法解析JSON。' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}
		if (!Array.isArray(keys) || keys.length === 0) {
			return new Response(JSON.stringify({ error: '请求体无效，需要一个包含key的非空数组。' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}

		const stub = getDOStub(c);
		const configResp = await stub.fetch(new Request('http://do/__resolve-key-configs', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }),
		}));
		const { configs, groups } = await configResp.json() as {
			configs?: Array<{ api_key: string; providerType: string; providerName: string; baseUrl: string; models: string[] }>;
			groups?: Array<{ api_key: string; key_group: string }>;
		};

		const providerMap = new Map<string, { api_key: string; providerType: string; providerName: string; baseUrl: string; models: string[] }>();
		for (const cfg of configs ?? []) {
			if (!providerMap.has(cfg.api_key)) providerMap.set(cfg.api_key, cfg);
		}
		const groupMap = new Map<string, string>((groups ?? []).map((g) => [g.api_key, g.key_group]));

		const checkResults = await Promise.all(
			keys.map(async (key) => {
				try {
					const cfg = providerMap.get(key);
					const providerType = cfg?.providerType || 'gemini';
					const providerName = cfg?.providerName || '';
					const baseUrl = (cfg?.baseUrl || BASE_URL).replace(/\/+$/, '');
					const models: string[] = cfg?.models || [];
					const model = models.length > 0 ? models[Math.floor(Math.random() * models.length)] : '';

					if (!model) return { key, valid: true, skipped: true };

					const valid = await healthCheckKey(key, providerType, baseUrl, model, providerName);
					return { key, valid, error: valid ? null : 'Health check failed' };
				} catch (e: any) {
					console.log(`[health] ERROR key=${maskKey(key)} error=${e.message}`);
					return { key, valid: false, error: e.message };
				}
			})
		);

		const updates: Array<{ api_key: string; key_group: string }> = [];
		for (const r of checkResults) {
			if (r.skipped) continue;
			const target = r.valid ? 'normal' : 'abnormal';
			if (groupMap.get(r.key) !== target) updates.push({ api_key: r.key, key_group: target });
		}
		if (updates.length > 0) {
			await stub.fetch(new Request('http://do/__batch-update-key-group', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }),
			}));
		}

		return new Response(JSON.stringify(checkResults), {
			headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
		});
	}

	// Admin API → DO stub
	if (pathname.startsWith('/api/')) {
		const stub = getDOStub(c);
		const resp = await stub.fetch(c.req.raw);
		return new Response(resp.body, { status: resp.status, headers: resp.headers });
	}

	// Proxy routes → resolve config via DO, forward upstream from Worker
	let endpointId: string;
	if (pathname.startsWith('/v1/')) {
		endpointId = 'default';
	} else {
		endpointId = extractEndpointId(pathname) ?? 'default';
		if (endpointId !== 'default') {
			pathname = stripEndpointPrefix(pathname);
		}
	}

	const request = c.req.raw;
	const stub = getDOStub(c);

	// Anthropic messages
	if (pathname.endsWith('/messages') && request.method === 'POST') {
		let model: string | undefined;
		try {
			const cloned = request.clone();
			const body: { model?: string } = await cloned.json();
			model = body?.model;
		} catch {}

		const clientKey = request.headers.get('x-api-key') ?? request.headers.get('Authorization')?.replace('Bearer ', '') ?? null;
		const result = await resolveConfigAndAuth(stub, endpointId, model, c.env, clientKey);
		if (result instanceof Response) return result;

		return handleAnthropicMessages(request, {
			apiKey: result.apiKey,
			provider: buildProvider(result.providerType, result.baseUrl),
			providerName: result.providerName,
		});
	}

	// GET /v1/models — list all configured models
	if (pathname.endsWith('/models') && request.method === 'GET') {
		const modelsUrl = endpointId && endpointId !== 'default'
			? `http://do/__list-models?endpointId=${encodeURIComponent(endpointId)}`
			: 'http://do/__list-models';
		const resp = await stub.fetch(new Request(modelsUrl));
		const { models, error } = await resp.json() as { models?: string[]; error?: string };
		if (error) {
			return new Response(JSON.stringify({ error }), {
				status: 500,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}
		const data = (models as string[]).map((id: string) => ({ id, object: 'model' }));
		return new Response(JSON.stringify({ object: 'list', data }), {
			headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
		});
	}

	// OpenAI routes (chat completions, embeddings → need model binding)
	if (pathname.endsWith('/chat/completions') ||
		pathname.endsWith('/embeddings')) {
		let model: string | undefined;
		try {
			const cloned = request.clone();
			const body: { model?: string } = await cloned.json();
			model = body?.model;
		} catch {}

		const clientKey = request.headers.get('Authorization')?.replace('Bearer ', '') ?? null;
		const result = await resolveConfigAndAuth(stub, endpointId, model, c.env, clientKey);
		if (result instanceof Response) return result;

		return handleOpenAI(request, {
			apiKey: result.apiKey,
			provider: buildProvider(result.providerType, result.baseUrl),
			providerName: result.providerName,
			baseUrl: result.baseUrl,
			providerType: result.providerType,
		});
	}

	return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json', ...fixCors({}).headers } });
});

type Env = {
	LOAD_BALANCER: DurableObjectNamespace<LoadBalancer>;
	AUTH_KEY: string;
	HOME_ACCESS_KEY: string;
};

async function scheduledHandler(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
	try {
		const id: DurableObjectId = env.LOAD_BALANCER.idFromName('loadbalancer');
		const stub = env.LOAD_BALANCER.get(id, { locationHint: 'wnam' });

		const resp = await stub.fetch(new Request('http://do/__resolve-abnormal-keys'));
		const { rows } = await resp.json() as { rows?: Array<{ apiKey: string; providerType: string; providerName: string; baseUrl: string; model: string }> };
		if (!rows || rows.length === 0) return;

		const updates: Array<{ api_key: string; key_group: string }> = [];
		const concurrency = 5;
		for (let i = 0; i < rows.length; i += concurrency) {
			const batch = rows.slice(i, i + concurrency);
			const results = await Promise.all(batch.map(row =>
				healthCheckKey(row.apiKey, row.providerType, row.baseUrl, row.model, row.providerName)
			));
			for (let j = 0; j < results.length; j++) {
				if (results[j]) updates.push({ api_key: batch[j].apiKey, key_group: 'normal' });
			}
		}

		if (updates.length > 0) {
			await stub.fetch(new Request('http://do/__batch-update-key-group', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }),
			}));
		}
	} catch (err) {
		console.error('scheduledHandler error:', err);
	}
}

export default {
	fetch: app.fetch,
	scheduled: scheduledHandler,
};

export { LoadBalancer };
