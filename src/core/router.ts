import { HttpError } from './utils';
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
	if (endpointId === 'default') return null;

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
}

/** Resolve endpoint → provider config → Provider instance. Throws HttpError on failure. */
export async function resolveProvider(sql: DurableObjectStorage['sql'], endpointId: string): Promise<ResolvedProvider> {
	const endpoint = await getEndpointConfig(sql, endpointId);
	if (!endpoint) {
		throw new HttpError(
			endpointId === 'default'
				? 'No endpoint configured. Use /e/:endpointId/ prefix or create an endpoint in the admin panel.'
				: `Endpoint "${endpointId}" not found or disabled.`,
			404
		);
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

	let provider: Provider;
	if (provConfig.type === 'openai_compat') {
		provider = new OpenAICompatProvider(provConfig.base_url);
	} else if (provConfig.type === 'anthropic') {
		provider = new AnthropicProvider(provConfig.base_url);
	} else {
		provider = new GeminiProvider(provConfig.base_url);
	}

	return { provider, forwardClientKey, endpoint };
}
