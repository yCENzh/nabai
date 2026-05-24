import { HttpError, fixCors, makeHeaders, generateId, BASE_URL, API_VERSION, maskKey } from '../core/utils';
import type { CanonicalRequest } from '../core/types';
import type { Provider } from '../providers/base';
import { getRandomApiKey, markKeyAbnormal } from '../pool/key-pool';
import { OpenAIProtocolAdapter } from '../protocols/openai';
import { parseStream, parseStreamFlush, toOpenAiStream, toOpenAiStreamFlush } from '../providers/gemini-stream';
import { resolveProvider } from '../core/router';

const adapter = new OpenAIProtocolAdapter();

function extractClientApiKey(request: Request, url: URL): string | null {
	if (url.searchParams.has('key')) {
		const key = url.searchParams.get('key');
		if (key) return key;
	}

	const googApiKey = request.headers.get('x-goog-api-key');
	if (googApiKey) return googApiKey;

	const authHeader = request.headers.get('Authorization');
	if (authHeader && authHeader.startsWith('Bearer ')) {
		return authHeader.substring(7);
	}

	return null;
}

async function forwardRequest(
	targetUrl: string,
	request: Request,
	headers: Headers,
	apiKey: string,
	sql: DurableObjectStorage['sql']
): Promise<Response> {
	const response = await fetch(targetUrl, {
		method: request.method,
		headers: headers,
		body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
	});

	if (response.status === 429) {
		console.log(`API key ${maskKey(apiKey)} received 429 status code.`);
		await markKeyAbnormal(sql, apiKey);
	}

	const responseHeaders = new Headers(response.headers);
	responseHeaders.set('Access-Control-Allow-Origin', '*');
	responseHeaders.delete('transfer-encoding');
	responseHeaders.delete('connection');
	responseHeaders.delete('keep-alive');
	responseHeaders.delete('content-encoding');
	responseHeaders.set('Referrer-Policy', 'no-referrer');

	return new Response(response.body, {
		status: response.status,
		headers: responseHeaders,
	});
}

async function forwardRequestWithLoadBalancing(
	targetUrl: string,
	request: Request,
	forwardClientKeyEnabled: boolean,
	sql: DurableObjectStorage['sql']
): Promise<Response> {
	try {
		let headers = new Headers();
		const url = new URL(targetUrl);

		if (request.headers.has('content-type')) {
			headers.set('content-type', request.headers.get('content-type')!);
		}

		if (forwardClientKeyEnabled) {
			const clientApiKey = extractClientApiKey(request, url);

			if (clientApiKey) {
				url.searchParams.set('key', clientApiKey);
				headers.set('x-goog-api-key', clientApiKey);
			}

			return forwardRequest(url.toString(), request, headers, clientApiKey || '', sql);
		}
		const apiKey = await getRandomApiKey(sql);
		if (!apiKey) {
			return new Response('No API keys configured in the load balancer.', { status: 500 });
		}

		url.searchParams.set('key', apiKey);
		headers.set('x-goog-api-key', apiKey);
		return forwardRequest(url.toString(), request, headers, apiKey, sql);
	} catch (error) {
		console.error('Failed to fetch:', error);
		return new Response('Internal Server Error', {
			status: 500,
			headers: { 'Content-Type': 'text/plain' },
		});
	}
}

async function handleModels(apiKey: string) {
	const response = await fetch(`${BASE_URL}/${API_VERSION}/models`, {
		headers: makeHeaders(apiKey),
	});

	let responseBody: BodyInit | null = response.body;
	if (response.ok) {
		const { models } = JSON.parse(await response.text());
		responseBody = JSON.stringify(
			{
				object: 'list',
				data: models.map(({ name }: any) => ({
					id: name.replace('models/', ''),
					object: 'model',
					created: 0,
					owned_by: '',
				})),
			},
			null,
			'  '
		);
	}
	return new Response(responseBody, fixCors(response));
}

async function handleEmbeddings(req: any, apiKey: string) {
	const DEFAULT_EMBEDDINGS_MODEL = 'text-embedding-004';

	if (typeof req.model !== 'string') {
		throw new HttpError('model is not specified', 400);
	}

	let model;
	if (req.model.startsWith('models/')) {
		model = req.model;
	} else {
		if (!req.model.startsWith('gemini-')) {
			req.model = DEFAULT_EMBEDDINGS_MODEL;
		}
		model = 'models/' + req.model;
	}

	if (!Array.isArray(req.input)) {
		req.input = [req.input];
	}

	const response = await fetch(`${BASE_URL}/${API_VERSION}/${model}:batchEmbedContents`, {
		method: 'POST',
		headers: makeHeaders(apiKey, { 'Content-Type': 'application/json' }),
		body: JSON.stringify({
			requests: req.input.map((text: string) => ({
				model,
				content: { parts: { text } },
				outputDimensionality: req.dimensions,
			})),
		}),
	});

	let responseBody: BodyInit | null = response.body;
	if (response.ok) {
		const { embeddings } = JSON.parse(await response.text());
		responseBody = JSON.stringify(
			{
				object: 'list',
				data: embeddings.map(({ values }: any, index: number) => ({
					object: 'embedding',
					index,
					embedding: values,
				})),
				model: req.model,
			},
			null,
			'  '
		);
	}
	return new Response(responseBody, fixCors(response));
}

async function handleCompletions(request: Request, apiKey: string, provider: Provider) {
	const requestId = 'chatcmpl-' + generateId();
	const canonical = await adapter.parseRequest(request, { requestId });
	const isStream = canonical.stream ?? false;

	if (!isStream) {
		try {
			const { response: upstreamResp } = await provider.invoke(canonical, { apiKey });
			if (!upstreamResp.ok) {
				const errText = await upstreamResp.text();
				console.error('Upstream error:', errText);
				return new Response(JSON.stringify({ error: 'Failed to parse response' }), {
					...fixCors(upstreamResp),
					status: upstreamResp.status,
				});
			}
			const data: any = await upstreamResp.json();
			if (provider.type === 'gemini' && !data.candidates) {
				return new Response(JSON.stringify({ error: 'Failed to parse response' }), {
					...fixCors(upstreamResp),
					status: 500,
				});
			}
			const canonicalResp = provider.parseResponse(data, canonical);
			return adapter.renderJson(canonicalResp, { requestId });
		} catch (err) {
			console.error('Error in completions:', err);
			return adapter.renderError(err, { requestId });
		}
	}

	// Streaming
	try {
		const { response } = await provider.invoke(canonical, { apiKey });
		console.log('[proxy] upstream response status:', response.status, 'type:', provider.type);
		if (!response.ok) {
			const errText = await response.text();
			console.error('Upstream error:', errText);
			return new Response(JSON.stringify({ error: 'Failed to parse response' }), {
				...fixCors(response),
				status: response.status,
			});
		}

		// Use TransformStream pipeline for Gemini (legacy), async iterator for others
		if (provider.type === 'gemini') {
			const shared = {};
			const responseBody = response
				.body!.pipeThrough(new TextDecoderStream())
				.pipeThrough(
					new TransformStream({
						transform: parseStream,
						flush: parseStreamFlush,
						buffer: '',
						shared,
					} as any)
				)
				.pipeThrough(
					new TransformStream({
						transform: toOpenAiStream,
						flush: toOpenAiStreamFlush,
						model: canonical.model,
						id: requestId,
						last: [],
						reasoningLast: [],
						shared,
					} as any)
				)
				.pipeThrough(new TextEncoderStream());

			return new Response(responseBody, fixCors(response));
		}

		// For non-Gemini providers, use async iterator → OpenAI SSE
		const events = provider.parseStream(response, canonical);
		return adapter.renderStream(events, { requestId });
	} catch (err) {
		console.error('Error in stream completions:', err);
		return adapter.renderError(err, { requestId });
	}
}

export async function handleOpenAI(
	request: Request,
	env: { AUTH_KEY: string },
	sql: DurableObjectStorage['sql'],
	endpointId: string = 'default'
): Promise<Response> {
	let apiKey: string | null;
	const authHeader = request.headers.get('Authorization');
	apiKey = authHeader?.replace('Bearer ', '') ?? null;

	if (!apiKey) {
		return new Response('No API key found in the client headers,please check your request!', { status: 400 });
	}

	// Resolve endpoint → provider config
	let provider, forwardClientKey, endpoint;
	try {
		({ provider, forwardClientKey, endpoint } = await resolveProvider(sql, endpointId));
	} catch (err: any) {
		return new Response(err.message, { status: err.status || 503 });
	}

	// Auth: forward_client_key → use client's key directly; otherwise → verify AUTH_KEY, use pool key
	if (!forwardClientKey && env.AUTH_KEY) {
		if (apiKey !== env.AUTH_KEY) {
			return new Response('Unauthorized', { status: 401, headers: fixCors({}).headers });
		}
		const providerId = endpoint?.provider_id;
		apiKey = await getRandomApiKey(sql, providerId);
		if (!apiKey) {
			const hint = providerId ? ` for provider "${providerId}"` : '';
			return new Response(`No API keys available${hint}. Please add keys in the admin panel.`, { status: 500 });
		}
	}

	const url = new URL(request.url);
	const pathname = url.pathname;

	const assert = (success: Boolean) => {
		if (!success) {
			throw new HttpError('The specified HTTP method is not allowed for the requested resource', 400);
		}
	};
	const errHandler = (err: Error) => {
		console.error(err);
		return new Response(err.message, fixCors({ statusText: err.message ?? 'Internal Server Error', status: 500 }));
	};

	switch (true) {
		case pathname.endsWith('/chat/completions'):
			assert(request.method === 'POST');
			return handleCompletions(request, apiKey, provider).catch(errHandler);
		case pathname.endsWith('/embeddings'):
			assert(request.method === 'POST');
			return handleEmbeddings(await request.json(), apiKey).catch(errHandler);
		case pathname.endsWith('/models'):
			assert(request.method === 'GET');
			return handleModels(apiKey).catch(errHandler);
		default:
			throw new HttpError('404 Not Found', 404);
	}
}

export async function handleGeminiProxy(
	request: Request,
	env: { AUTH_KEY: string },
	sql: DurableObjectStorage['sql']
): Promise<Response> {
	const url = new URL(request.url);
	const search = url.search;
	const pathname = url.pathname;

	const targetUrl = `https://generativelanguage.googleapis.com${pathname}${search}`;

	if (!env.AUTH_KEY) {
		return forwardRequestWithLoadBalancing(targetUrl, request, true, sql);
	}

	{
		let isAuthorized = false;
		if (search.includes('key=')) {
			const urlObj = new URL(targetUrl);
			const requestKey = urlObj.searchParams.get('key');
			if (requestKey && requestKey === env.AUTH_KEY) {
				isAuthorized = true;
			}
		} else {
			const requestKey = request.headers.get('x-goog-api-key');
			if (requestKey && requestKey === env.AUTH_KEY) {
				isAuthorized = true;
			}
		}

		if (!isAuthorized) {
			return new Response('Unauthorized', { status: 401, headers: fixCors({}).headers });
		}
	}
	return forwardRequestWithLoadBalancing(targetUrl, request, false, sql);
}
