import { HttpError, maskKey } from './utils';
import type { Provider } from '../providers/base';
import { GeminiProvider } from '../providers/gemini';
import { OpenAICompatProvider } from '../providers/openai-compat';
import { AnthropicProvider } from '../providers/anthropic';

/** Extract endpointId from URL path like /e/:endpointId/... Returns null for legacy paths. */
export function extractEndpointId(pathname: string): string | null {
	const match = pathname.match(/^\/e\/([^/]+)\//);
	return match ? match[1] : null;
}

/** Strip the /e/:endpointId prefix from pathname */
export function stripEndpointPrefix(pathname: string): string {
	return pathname.replace(/^\/e\/[^/]+/, '');
}

export interface EndpointConfig {
	id: string;
	path: string;
	provider_id: string;
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

/** Look up endpoint config by id. Returns null if not found or disabled. */
export async function getEndpointConfig(
	sql: DurableObjectStorage['sql'],
	endpointId: string
): Promise<EndpointConfig | null> {
	const results = await sql
		.exec('SELECT id, path, provider_id, enabled FROM endpoints WHERE id = ?', endpointId)
		.raw<any>();
	const rows = Array.from(results);
	if (rows.length === 0) return null;
	const row = rows[0] as any;
	const config: EndpointConfig = {
		id: row[0], path: row[1], provider_id: row[2], enabled: row[3] === 1,
	};
	return config.enabled ? config : null;
}

/** Look up provider config by id. Returns null if not found. */
export async function getProviderConfig(
	sql: DurableObjectStorage['sql'],
	providerId: string
): Promise<ProviderConfig | null> {
	const results = await sql
		.exec('SELECT id, type, name, base_url, enabled, config_json FROM providers WHERE id = ?', providerId)
		.raw<any>();
	const rows = Array.from(results);
	if (rows.length === 0) return null;
	const row = rows[0] as any;
	const config: ProviderConfig = {
		id: row[0], type: row[1], name: row[2], base_url: row[3],
		enabled: row[4] === 1, config_json: row[5],
	};
	return config.enabled ? config : null;
}

export interface ResolvedProvider {
	provider: Provider;
	forwardClientKey: boolean;
	endpoint: EndpointConfig | null;
	apiKey?: string;
}

function buildProvider(provConfig: ProviderConfig): Provider {
	if (provConfig.type === 'openai_compat') return new OpenAICompatProvider(provConfig.base_url);
	if (provConfig.type === 'anthropic') return new AnthropicProvider(provConfig.base_url);
	return new GeminiProvider(provConfig.base_url);
}

async function resolveDefaultEndpoint(sql: DurableObjectStorage['sql'], model: string): Promise<ResolvedProvider> {
	const rows = Array.from(sql.exec(`
		SELECT k.api_key, p.id, p.type, p.name, p.base_url, p.enabled, p.config_json
		FROM api_keys k
		JOIN providers p ON p.id = k.provider_id
		WHERE p.enabled = 1 AND p.in_default_rotation = 1
		  AND k.enabled = 1 AND k.in_default_rotation = 1 AND k.model = ? AND k.key_group = 'normal'
		ORDER BY RANDOM() LIMIT 1
	`, model).raw<any>());

	if (rows.length === 0) {
		throw new HttpError(`No rotation keys available for model "${model}". Add a key with this model and enable "加入轮询".`, 503);
	}

	const row = rows[0];
	const apiKey = row[0] as string;
	const provConfig: ProviderConfig = {
		id: row[1] as string, type: row[2] as string, name: row[3] as string,
		base_url: row[4] as string, enabled: row[5] === 1, config_json: row[6] as string,
	};
	console.log(`[default-rot] selected key ${maskKey(apiKey)} from provider ${provConfig.id}`);
	return { provider: buildProvider(provConfig), forwardClientKey: false, endpoint: null, apiKey };
}

/** Resolve endpoint → provider config → Provider instance. Throws HttpError on failure. */
export async function resolveProvider(sql: DurableObjectStorage['sql'], endpointId: string, model?: string): Promise<ResolvedProvider> {
	if (endpointId === 'default') {
		const endpoint = await getEndpointConfig(sql, 'default');
		if (endpoint) {
			const provConfig = await getProviderConfig(sql, endpoint.provider_id);
			if (!provConfig) {
				throw new HttpError(`Provider "${endpoint.provider_id}" is disabled or not found.`, 503);
			}
			let forwardClientKey = false;
			try { forwardClientKey = JSON.parse(provConfig.config_json).forward_client_key === true; } catch {}
			return { provider: buildProvider(provConfig), forwardClientKey, endpoint };
		}
		if (!model) throw new HttpError('Model is required for default endpoint rotation.', 400);
		return resolveDefaultEndpoint(sql, model);
	}

	const endpoint = await getEndpointConfig(sql, endpointId);
	if (!endpoint) {
		throw new HttpError(`Endpoint "${endpointId}" not found or disabled.`, 404);
	}

	const provConfig = await getProviderConfig(sql, endpoint.provider_id);
	if (!provConfig) {
		throw new HttpError(`Provider "${endpoint.provider_id}" is disabled or not found.`, 503);
	}

	let forwardClientKey = false;
	try {
		const cfg = JSON.parse(provConfig.config_json);
		forwardClientKey = cfg.forward_client_key === true;
	} catch {}

	return { provider: buildProvider(provConfig), forwardClientKey, endpoint };
}
