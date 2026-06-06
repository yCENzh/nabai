import { HttpError, generateId } from '../core/utils';
import { AnthropicProtocolAdapter } from '../protocols/anthropic';
import { getRandomApiKey } from '../pool/key-pool';
import { resolveProvider } from '../core/router';

const anthropicAdapter = new AnthropicProtocolAdapter();

export async function handleAnthropicMessages(
	request: Request,
	env: { AUTH_KEY: string },
	sql: DurableObjectStorage['sql'],
	endpointId: string = 'default'
): Promise<Response> {
	const requestId = 'msg_' + generateId();

	const apiKeyHeader = request.headers.get('x-api-key');
	const authHeader = request.headers.get('Authorization');
	let apiKey: string | null = apiKeyHeader || (authHeader?.replace('Bearer ', '') ?? null);

	if (!apiKey) {
		return anthropicAdapter.renderError(
			new HttpError('No API key found in the client headers', 401),
			{ requestId }
		);
	}

	let provider, forwardClientKey, endpoint, resolvedApiKey;
	let parsedBody: any;
	try {
		const cloned = request.clone();
		parsedBody = await cloned.json();
	} catch {}
	try {
		({ provider, forwardClientKey, endpoint, apiKey: resolvedApiKey } = await resolveProvider(sql, endpointId, parsedBody?.model));
	} catch (err: any) {
		return anthropicAdapter.renderError(err, { requestId });
	}

	if (!forwardClientKey && env.AUTH_KEY) {
		if (apiKey !== env.AUTH_KEY) {
			return anthropicAdapter.renderError(
				new HttpError('Unauthorized', 401),
				{ requestId }
			);
		}
		if (resolvedApiKey) {
			apiKey = resolvedApiKey;
		} else {
			const providerId = endpoint?.provider_id;
			apiKey = await getRandomApiKey(sql, providerId);
			if (!apiKey) {
				return anthropicAdapter.renderError(
					new HttpError('No API keys configured in the load balancer.', 500),
					{ requestId }
				);
			}
		}
	}

	try {
		const canonical = await anthropicAdapter.parseRequest(request, { requestId });
		const isStream = canonical.stream ?? false;
		console.log(`[proxy] stream=${isStream} tools=${canonical.tools?.length ?? 0} provider=${provider.type} model=${canonical.model}`);

		if (!isStream) {
			const { response: upstreamResp } = await provider.invoke(canonical, { apiKey });
			if (!upstreamResp.ok) {
				const errText = await upstreamResp.text();
				console.error('Upstream error:', errText);
				return anthropicAdapter.renderError(
					new HttpError(`Upstream error: ${upstreamResp.status}`, upstreamResp.status),
					{ requestId }
				);
			}
			const data: any = await upstreamResp.json();
			if (provider.type === 'gemini' && !data.candidates) {
				return anthropicAdapter.renderError(
					new HttpError('Invalid response from upstream', 502),
					{ requestId }
				);
			}
			const canonicalResp = provider.parseResponse(data, canonical);
			return anthropicAdapter.renderJson(canonicalResp, { requestId });
		}

		const { response: upstreamResp } = await provider.invoke(canonical, { apiKey });
		if (!upstreamResp.ok) {
			const errText = await upstreamResp.text();
			console.error('[anthropic] error:', errText);
			return anthropicAdapter.renderError(
				new HttpError(`Upstream error: ${upstreamResp.status}`, upstreamResp.status),
				{ requestId }
			);
		}

		const events = provider.parseStream(upstreamResp, canonical);
		return anthropicAdapter.renderStream(events, { requestId, model: canonical.model });
	} catch (err) {
		console.error('[anthropic] error:', err);
		return anthropicAdapter.renderError(err, { requestId });
	}
}
