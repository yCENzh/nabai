import { HttpError, maskKey } from './utils';
import type { Provider } from '../providers/base';
import { GeminiProvider } from '../providers/gemini';
import { OpenAICompatProvider } from '../providers/openai-compat';
import { AnthropicProvider } from '../providers/anthropic';

export function extractEndpointId(pathname: string): string | null {
	const match = pathname.match(/^\/e\/([^/]+)\//);
	return match ? match[1] : null;
}

export function stripEndpointPrefix(pathname: string): string {
	return pathname.replace(/^\/e\/[^/]+/, '');
}

export interface EndpointConfig {
	id: string;
	path: string;
	enabled: boolean;
}

export interface ProviderConfig {
	id: string;
	type: string;
	name: string;
	base_url: string;
	enabled: boolean;
	config_json: string;
}

export interface ResolvedProvider {
	provider: Provider;
	providerName: string;
	forwardClientKey: boolean;
	endpoint: EndpointConfig | null;
	apiKey?: string;
}

function buildProvider(provConfig: ProviderConfig): Provider {
	if (provConfig.type === 'openai_compat') return new OpenAICompatProvider(provConfig.base_url);
	if (provConfig.type === 'anthropic') return new AnthropicProvider(provConfig.base_url);
	return new GeminiProvider(provConfig.base_url);
}

export async function resolveProvider(sql: DurableObjectStorage['sql'], endpointId: string, model?: string): Promise<ResolvedProvider> {
	const epRows = Array.from(sql.exec(
		'SELECT id, path, enabled FROM endpoints WHERE id = ?', endpointId
	).raw<any>());
	if (epRows.length === 0) {
		throw new HttpError(
			endpointId === 'default'
				? 'No endpoint configured. Create an endpoint in the admin panel.'
				: `Endpoint "${endpointId}" not found.`,
			404
		);
	}
	const ep = epRows[0];
	if (ep[2] !== 1) throw new HttpError(`Endpoint "${endpointId}" is disabled.`, 404);
	const endpoint: EndpointConfig = { id: ep[0], path: ep[1], enabled: true };

	if (!model) throw new HttpError('Model is required. Provide a model in the request body.', 400);

	const emRows = Array.from(sql.exec(
		'SELECT 1 FROM endpoint_models WHERE endpoint_id = ? AND model = ?', endpointId, model
	).raw<any>());
	if (emRows.length === 0) {
		throw new HttpError(`Model "${model}" is not bound to endpoint "${endpointId}".`, 403);
	}

	const keys = Array.from(sql.exec(`
		SELECT DISTINCT k.api_key
		FROM api_keys k
		JOIN key_models km ON km.api_key = k.api_key AND km.model = ?
		WHERE k.enabled = 1 AND k.key_group = 'normal'
		ORDER BY RANDOM() LIMIT 1
	`, model).raw<any>());

	if (keys.length === 0) {
		throw new HttpError(`No available key for model "${model}" on endpoint "${endpointId}".`, 503);
	}

	const apiKey = keys[0][0] as string;

	const providers = Array.from(sql.exec(`
		SELECT p.id, p.type, p.name, p.base_url, p.enabled, p.config_json
		FROM key_providers kp
		JOIN providers p ON p.id = kp.provider_id
		WHERE kp.api_key = ? AND p.enabled = 1
		ORDER BY RANDOM() LIMIT 1
	`, apiKey).raw<any>());

	if (providers.length === 0) {
		throw new HttpError(`No available provider for key on endpoint "${endpointId}".`, 503);
	}

	const prow = providers[0];
	const provConfig: ProviderConfig = {
		id: prow[0] as string, type: prow[1] as string, name: prow[2] as string,
		base_url: prow[3] as string, enabled: prow[4] === 1, config_json: prow[5] as string,
	};
	let forwardClientKey = false;
	try { forwardClientKey = JSON.parse(provConfig.config_json).forward_client_key === true; } catch {}
	console.log(`[rot] key=${maskKey(apiKey)} provider=${provConfig.name}(${provConfig.type})`);
	return { provider: buildProvider(provConfig), providerName: provConfig.name, forwardClientKey, endpoint, apiKey };
}
