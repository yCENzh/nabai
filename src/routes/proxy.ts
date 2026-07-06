import { HttpError, fixCors, makeHeaders, generateId } from '../core/utils';
import type { Provider } from '../providers/base';
import { OpenAIProtocolAdapter } from '../protocols/openai';

const adapter = new OpenAIProtocolAdapter();

interface EmbeddingsRequest {
	model?: string;
	input?: string | string[];
	dimensions?: number;
}

async function handleEmbeddings(req: EmbeddingsRequest, apiKey: string, baseUrl: string, providerType: string) {
	if (typeof req.model !== 'string') {
		throw new HttpError('model is not specified', 400);
	}

	const modelName = req.model.startsWith('models/') ? req.model.substring(7) : req.model;

	if (providerType === 'gemini') {
		const model = 'models/' + modelName;
		const inputs = (Array.isArray(req.input) ? req.input : [req.input]).filter((x): x is string => x != null);

		const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1beta/${model}:batchEmbedContents`, {
			method: 'POST',
			headers: makeHeaders(apiKey, { 'Content-Type': 'application/json' }),
			body: JSON.stringify({
				requests: inputs.map(text => ({
					model,
					content: { parts: { text } },
					outputDimensionality: req.dimensions,
				})),
			}),
		});

		let responseBody: BodyInit | null = response.body;
		if (response.ok) {
			const body: { embeddings?: Array<{ values?: number[] }> } = JSON.parse(await response.text());
			responseBody = JSON.stringify(
				{
					object: 'list',
					data: (body.embeddings ?? []).map((item, index: number) => ({
						object: 'embedding',
						index,
						embedding: item.values,
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
	// Note: baseUrl already includes /v1 (e.g. https://api.openai.com/v1),
	// so only append /embeddings (not /v1/embeddings)
	const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
		body: JSON.stringify({ model: modelName, input: req.input, dimensions: req.dimensions }),
	});
	return new Response(response.body, fixCors(response));
}

async function handleCompletions(request: Request, apiKey: string, provider: Provider, providerName: string, queryParams?: URLSearchParams) {
	const requestId = 'chatcmpl-' + generateId();
	const canonical = await adapter.parseRequest(request, { requestId });
	const isStream = canonical.stream ?? false;
	console.log(`[proxy] stream=${isStream} tools=${canonical.tools?.length ?? 0} provider=${providerName}(${provider.type}) model=${canonical.model}`);

	if (!isStream) {
		try {
			const { response: upstreamResp } = await provider.invoke(canonical, { apiKey, queryParams, requestHeaders: request.headers });
			if (!upstreamResp.ok) {
				const errText = await upstreamResp.text();
				console.error('Upstream error:', errText);
				return new Response(errText || JSON.stringify({ error: 'Upstream error' }), {
					...fixCors(upstreamResp),
					status: upstreamResp.status,
				});
			}
			const data: any = await upstreamResp.json();
			if (provider.type === 'gemini' && !data.candidates) {
				return new Response(JSON.stringify({ error: 'Invalid upstream response: no candidates' }), {
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
		const { response } = await provider.invoke(canonical, { apiKey, queryParams, requestHeaders: request.headers });
		if (!response.ok) {
			const errText = await response.text();
			console.error('Upstream error:', errText);
			return new Response(errText || JSON.stringify({ error: 'Upstream error' }), {
				...fixCors(response),
				status: response.status,
			});
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
	const queryParams = url.searchParams;

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
			return handleCompletions(request, apiKey, provider, providerName, queryParams).catch(errHandler);
		case pathname.endsWith('/embeddings'):
			assert(request.method === 'POST');
			return handleEmbeddings(await request.json(), apiKey, baseUrl, providerType).catch(errHandler);
		default:
			throw new HttpError('404 Not Found', 404);
	}
}
