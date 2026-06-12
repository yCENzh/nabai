import { HttpError, generateId } from '../core/utils';
import type { Provider } from '../providers/base';
import { AnthropicProtocolAdapter } from '../protocols/anthropic';

const anthropicAdapter = new AnthropicProtocolAdapter();

export async function handleAnthropicMessages(
	request: Request,
	config: { apiKey: string; provider: Provider; providerName: string }
): Promise<Response> {
	const requestId = 'msg_' + generateId();
	const { apiKey, provider, providerName } = config;
	const url = new URL(request.url);
	const queryParams = url.searchParams;

	try {
		const canonical = await anthropicAdapter.parseRequest(request, { requestId });
		const isStream = canonical.stream ?? false;
		console.log(`[proxy] stream=${isStream} tools=${canonical.tools?.length ?? 0} provider=${providerName}(${provider.type}) model=${canonical.model}`);

		if (!isStream) {
			const { response: upstreamResp } = await provider.invoke(canonical, { apiKey, queryParams, requestHeaders: request.headers });
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

		const { response: upstreamResp } = await provider.invoke(canonical, { apiKey, queryParams, requestHeaders: request.headers });
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
