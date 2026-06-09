import { Hono } from 'hono';
import { Render } from './render';
import { LoadBalancer } from './handler';
import { getAuthKey } from './auth';
import { getCookie, setCookie } from 'hono/cookie';
import { extractEndpointId, stripEndpointPrefix } from './core/router';
import { handleOpenAI, extractClientApiKey as extractGeminiClientKey } from './routes/proxy';
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

async function forwardGemini(
	url: URL,
	request: Request,
	apiKey: string | null,
	stub: DurableObjectStub
): Promise<Response> {
	const headers = new Headers();
	if (request.headers.has('content-type')) {
		headers.set('content-type', request.headers.get('content-type')!);
	}
	if (apiKey) {
		url.searchParams.set('key', apiKey);
		headers.set('x-goog-api-key', apiKey);
	}
	const response = await fetch(url.toString(), {
		method: request.method,
		headers,
		body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
	});
	if (response.status === 429 && apiKey) {
		stub.fetch(new Request('http://do/__mark-abnormal', {
			method: 'POST',
			body: JSON.stringify({ apiKey }),
		})).catch(() => {});
	}
	const responseHeaders = new Headers(response.headers);
	responseHeaders.set('Access-Control-Allow-Origin', '*');
	responseHeaders.delete('transfer-encoding');
	responseHeaders.delete('connection');
	responseHeaders.delete('keep-alive');
	responseHeaders.delete('content-encoding');
	responseHeaders.set('Referrer-Policy', 'no-referrer');
	return new Response(response.body, { status: response.status, headers: responseHeaders });
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

	// Admin API → DO stub
	if (pathname.startsWith('/api/')) {
		const stub = getDOStub(c);
		const resp = await stub.fetch(c.req.raw);
		return new Response(resp.body, { status: resp.status, headers: resp.headers });
	}

	// Proxy routes — resolve config via DO, forward upstream from Worker
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

	// OpenAI routes (chat completions, embeddings — need model binding)
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

	// Gemini proxy (everything else)
	const geminiUrl = new URL(`https://generativelanguage.googleapis.com${pathname}${url.search}`);

	let isAuthorized = false;
	if (c.env.AUTH_KEY) {
		if (geminiUrl.searchParams.get('key') === c.env.AUTH_KEY) isAuthorized = true;
		if (!isAuthorized && request.headers.get('x-goog-api-key') === c.env.AUTH_KEY) isAuthorized = true;
		if (!isAuthorized) {
			return new Response('Unauthorized', { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
		}
	}

	// Resolve API key for Gemini
	if (isAuthorized || !c.env.AUTH_KEY) {
		const clientKey = extractGeminiClientKey(request, geminiUrl);
		if (isAuthorized || !clientKey) {
			const keyResp = await stub.fetch(new Request('http://do/__resolve-key', { method: 'POST' }));
			const keyData = await keyResp.json() as any;
			if (keyData.apiKey) {
				return forwardGemini(geminiUrl, request, keyData.apiKey, stub);
			}
			if (isAuthorized) {
				return new Response('No API keys configured.', { status: 500 });
			}
		}
		if (clientKey) {
			return forwardGemini(geminiUrl, request, clientKey, stub);
		}
		return new Response('No API keys configured.', { status: 500 });
	}

	return forwardGemini(geminiUrl, request, null, stub);
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
