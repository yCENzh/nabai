import { HttpError, fixCors, makeHeaders, generateId } from '../core/utils';
import type { Provider } from '../providers/base';
import { OpenAIProtocolAdapter } from '../protocols/openai';
import { parseStream, parseStreamFlush, toOpenAiStream, toOpenAiStreamFlush } from '../providers/gemini-stream';

const adapter = new OpenAIProtocolAdapter();

export function extractClientApiKey(request: Request, url: URL): string | null {
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

async function handleEmbeddings(req: any, apiKey: string, baseUrl: string, providerType: string) {
	if (typeof req.model !== 'string') {
		throw new HttpError('model is not specified', 400);
	}

	const modelName = req.model.startsWith('models/') ? req.model.substring(7) : req.model;

	if (providerType === 'gemini') {
		const model = 'models/' + modelName;
		const inputs = Array.isArray(req.input) ? req.input : [req.input];

		const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1beta/${model}:batchEmbedContents`, {
			method: 'POST',
			headers: makeHeaders(apiKey, { 'Content-Type': 'application/json' }),
			body: JSON.stringify({
				requests: inputs.map((text: string) => ({
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
					model: modelName,
				},
				null,
				'  '
			);
		}
		return new Response(responseBody, fixCors(response));
	}

	// OpenAI-compatible providers: forward as-is with Bearer auth
	const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
		body: JSON.stringify({ model: modelName, input: req.input, dimensions: req.dimensions }),
	});
	return new Response(response.body, fixCors(response));
}

async function handleCompletions(request: Request, apiKey: string, provider: Provider, providerName: string) {
	const requestId = 'chatcmpl-' + generateId();
	const canonical = await adapter.parseRequest(request, { requestId });
	const isStream = canonical.stream ?? false;
	console.log(`[proxy] stream=${isStream} tools=${canonical.tools?.length ?? 0} provider=${providerName}(${provider.type}) model=${canonical.model}`);

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

	try {
		const { response } = await provider.invoke(canonical, { apiKey });
		if (!response.ok) {
			const errText = await response.text();
			console.error('Upstream error:', errText);
			return new Response(JSON.stringify({ error: 'Failed to parse response' }), {
				...fixCors(response),
				status: response.status,
			});
		}

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

		const events = provider.parseStream(response, canonical);
		return adapter.renderStream(events, { requestId, model: canonical.model });
	} catch (err) {
		console.error('Error in stream completions:', err);
		return adapter.renderError(err, { requestId });
	}
}

export async function handleOpenAI(
	request: Request,
	config: { apiKey: string; provider: Provider; providerName: string; baseUrl: string; providerType: string }
): Promise<Response> {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const { apiKey, provider, providerName, baseUrl, providerType } = config;

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
			return handleCompletions(request, apiKey, provider, providerName).catch(errHandler);
		case pathname.endsWith('/embeddings'):
			assert(request.method === 'POST');
			return handleEmbeddings(await request.json(), apiKey, baseUrl, providerType).catch(errHandler);
		default:
			throw new HttpError('404 Not Found', 404);
	}
}
