import { Hono } from 'hono';
import { Render } from './render';
import { LoadBalancer } from './handler';
import { getAuthKey } from './auth';
import { getCookie, setCookie } from 'hono/cookie';
import { extractEndpointId, stripEndpointPrefix } from './core/router';
import { handleOpenAI } from './routes/proxy';
import { handleAnthropicMessages } from './routes/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OpenAICompatProvider } from './providers/openai-compat';
import { AnthropicProvider } from './providers/anthropic';
import type { Provider } from './providers/base';
import { fixCors } from './core/utils';

const app = new Hono<{ Bindings: Env }>();

function buildProvider(type: string, baseUrl: string): Provider {
	if (type === 'openai_compat') return new OpenAICompatProvider(baseUrl);
	if (type === 'anthropic') return new AnthropicProvider(baseUrl);
	return new GeminiProvider(baseUrl);
}

function getDOStub(c: any): DurableObjectStub {
	const id: DurableObjectId = c.env.LOAD_BALANCER.idFromName('loadbalancer');
	return c.env.LOAD_BALANCER.get(id, { locationHint: 'wnam' });
}

async function resolveConfig(stub: DurableObjectStub, endpointId: string, model?: string): Promise<{ data: any; status: number }> {
	const resp = await stub.fetch(new Request('http://do/__resolve', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpointId, model }),
	}));
	return { data: await resp.json(), status: resp.status };
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

	// Admin API â†?DO stub
	if (pathname.startsWith('/api/')) {
		const stub = getDOStub(c);
		const resp = await stub.fetch(c.req.raw);
		return new Response(resp.body, { status: resp.status, headers: resp.headers });
	}

	// Proxy routes â€?resolve config via DO, forward upstream from Worker
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
			const body: any = await cloned.json();
			model = body?.model;
		} catch {}

		const { data: cfg, status: resolveStatus } = await resolveConfig(stub, endpointId, model);
		if (cfg.error) {
			return new Response(JSON.stringify({ error: cfg.error }), {
				status: resolveStatus,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}

		const clientKey = request.headers.get('x-api-key') ?? request.headers.get('Authorization')?.replace('Bearer ', '') ?? null;
		if (!cfg.forwardClientKey && c.env.AUTH_KEY) {
			if (clientKey !== c.env.AUTH_KEY) {
				return new Response('Unauthorized', { status: 401, headers: fixCors({}).headers });
			}
			if (!cfg.apiKey) {
				return new Response(JSON.stringify({ error: 'No API keys configured for this endpoint.' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
				});
			}
			return handleAnthropicMessages(request, { apiKey: cfg.apiKey, provider: buildProvider(cfg.providerType, cfg.baseUrl), providerName: cfg.providerName });
		}
		if (!clientKey) {
			return new Response(JSON.stringify({ error: 'No API key found in the client headers.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}
		return handleAnthropicMessages(request, { apiKey: clientKey, provider: buildProvider(cfg.providerType, cfg.baseUrl), providerName: cfg.providerName });
	}

	// OpenAI routes (chat completions, embeddings â€?need model binding)
	if (pathname.endsWith('/chat/completions') || pathname.endsWith('/completions') ||
		pathname.endsWith('/embeddings')) {
		let model: string | undefined;
		try {
			const cloned = request.clone();
			const body: any = await cloned.json();
			model = body?.model;
		} catch {}

		const { data: cfg, status: resolveStatus } = await resolveConfig(stub, endpointId, model);
		if (cfg.error) {
			return new Response(JSON.stringify({ error: cfg.error }), {
				status: resolveStatus,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}

		const clientKey = request.headers.get('Authorization')?.replace('Bearer ', '') ?? null;
		if (!cfg.forwardClientKey && c.env.AUTH_KEY) {
			if (clientKey !== c.env.AUTH_KEY) {
				return new Response('Unauthorized', { status: 401, headers: fixCors({}).headers });
			}
			if (!cfg.apiKey) {
				return new Response(JSON.stringify({ error: 'No API keys configured for this endpoint.' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
				});
			}
			return handleOpenAI(request, { apiKey: cfg.apiKey, provider: buildProvider(cfg.providerType, cfg.baseUrl), providerName: cfg.providerName, baseUrl: cfg.baseUrl, providerType: cfg.providerType });
		}
		if (!clientKey) {
			return new Response(JSON.stringify({ error: 'No API key found in the client headers.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...fixCors({}).headers },
			});
		}
		return handleOpenAI(request, { apiKey: clientKey, provider: buildProvider(cfg.providerType, cfg.baseUrl), providerName: cfg.providerName, baseUrl: cfg.baseUrl, providerType: cfg.providerType });
	}

});

type Env = {
	LOAD_BALANCER: DurableObjectNamespace<LoadBalancer>;
	AUTH_KEY: string;
	HOME_ACCESS_KEY: string;
};

export default {
	fetch: app.fetch,
};

export { LoadBalancer };
