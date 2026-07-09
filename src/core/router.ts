import { HttpError, maskKey } from './utils';
import type { Provider } from '../providers/base';
import { GeminiProvider } from '../providers/gemini';
import { OpenAICompatProvider } from '../providers/openai-compat';
import { AnthropicProvider } from '../providers/anthropic';

interface CachedKeyOption {
	apiKey: string;
	providerType: string;
	providerName: string;
	baseUrl: string;
}
interface CachedResolve {
	endpoint: EndpointConfig;
	keys: CachedKeyOption[];
	ts: number;
}

const resolveCache = new Map<string, CachedResolve>();
const CACHE_TTL = 300_000;
const CACHE_MAX = 1000;

const MODELS_CACHE_TTL = 600_000; // 10 min
const modelsCache = new Map<string, { data: string[]; ts: number }>();

export function clearResolveCache() {
	resolveCache.clear();
	modelsCache.clear();
}

export function extractEndpointId(pathname: string): string | null {
	const match = pathname.match(/^\/e\/([^/]+)\//);
	return match ? match[1] : null;
}

export function stripEndpointPrefix(pathname: string): string {
	return pathname.replace(/^\/e\/[^/]+/, '');
}

interface EndpointConfig {
	id: string;
	enabled: boolean;
}

interface ResolvedProvider {
	provider: Provider;
	providerName: string;
	baseUrl: string;
	endpoint: EndpointConfig | null;
	apiKey?: string;
}

export async function resolveProvider(sql: DurableObjectStorage['sql'], endpointId: string, model?: string): Promise<ResolvedProvider> {
	const cacheKey = `${endpointId}:${model ?? ''}`;
	const cached = resolveCache.get(cacheKey);
	if (cached && Date.now() - cached.ts < CACHE_TTL) {
		// 缓存命中：从已缓存的可用 key 列表中随机抽取一个
		if (cached.keys.length === 0) {
			throw new HttpError(`No available key for model "${model}" on endpoint "${endpointId}".`, 503);
		}
		const pick = cached.keys[Math.floor(Math.random() * cached.keys.length)];
		return {
			provider: buildProvider(pick.providerType, pick.baseUrl),
			providerName: pick.providerName,
			baseUrl: pick.baseUrl,
			endpoint: cached.endpoint,
			apiKey: pick.apiKey,
		};
	}
	// 缓存未命中或已过期：清理并重新查询
	resolveCache.delete(cacheKey);

	const epRows = Array.from(sql.exec(
		'SELECT id, enabled FROM endpoints WHERE id = ?', endpointId
	).raw<[string, number]>());
	if (epRows.length === 0) {
		throw new HttpError(
			endpointId === 'default'
				? 'No endpoint configured. Create an endpoint in the admin panel.'
				: `Endpoint "${endpointId}" not found.`,
			404
		);
	}
	const ep = epRows[0];
	if (ep[1] !== 1) throw new HttpError(`Endpoint "${endpointId}" is disabled.`, 404);
	const endpoint: EndpointConfig = { id: ep[0], enabled: true };

	if (!model) throw new HttpError('Model is required. Provide a model in the request body.', 400);

	const emRows = Array.from(sql.exec(
		'SELECT 1 FROM endpoint_models WHERE endpoint_id = ? AND model = ?', endpointId, model
	).raw<[number]>());
	if (emRows.length === 0) {
		throw new HttpError(`Model "${model}" is not bound to endpoint "${endpointId}".`, 403);
	}

	// 查询所有可用 key + 对应 provider 组合
	const rows = Array.from(sql.exec(`
		SELECT DISTINCT k.api_key, p.type, p.name, p.base_url, p.config_json
		FROM api_keys k
		JOIN key_models km ON km.api_key = k.api_key AND km.model = ?
		JOIN key_providers kp ON kp.api_key = k.api_key
		JOIN providers p ON p.id = kp.provider_id
		WHERE k.enabled = 1 AND k.key_group = 'normal' AND p.enabled = 1
	`, model).raw<[string, string, string, string, string]>());

	if (rows.length === 0) {
		throw new HttpError(`No available key for model "${model}" on endpoint "${endpointId}".`, 503);
	}

	const keys: CachedKeyOption[] = rows.map((row) => ({
		apiKey: row[0] as string,
		providerType: row[1] as string,
		providerName: row[2] as string,
		baseUrl: row[3] as string,
	}));

	// 写入缓存（限制最大条目数，防止内存泄漏）
	if (resolveCache.size >= CACHE_MAX) {
		// 简单淘汰：删最早写入的一个
		const firstKey = resolveCache.keys().next().value;
		if (firstKey) resolveCache.delete(firstKey);
	}
	resolveCache.set(cacheKey, { endpoint, keys, ts: Date.now() });

	// 随机抽取一个返回
	const pick = keys[Math.floor(Math.random() * keys.length)];
	console.log(`[rot] key=${maskKey(pick.apiKey)} provider=${pick.providerName}(${pick.providerType})`);
	return {
		provider: buildProvider(pick.providerType, pick.baseUrl),
		providerName: pick.providerName,
		baseUrl: pick.baseUrl,
		endpoint,
		apiKey: pick.apiKey,
	};
}

export function buildProvider(type: string, baseUrl: string): Provider {
	if (type === 'openai_compat') return new OpenAICompatProvider(baseUrl);
	if (type === 'anthropic') return new AnthropicProvider(baseUrl);
	return new GeminiProvider(baseUrl);
}

export function listModels(sql: DurableObjectStorage['sql'], endpointId?: string): string[] {
	const cacheKey = endpointId ?? '__global__';
	const cached = modelsCache.get(cacheKey);
	if (cached && Date.now() - cached.ts < MODELS_CACHE_TTL) {
		return cached.data;
	}

	let query: string;
	let bindings: any[] = [];
	if (endpointId) {
		query = `
			SELECT DISTINCT km.model
			FROM key_models km
			JOIN endpoint_models em ON em.model = km.model AND em.endpoint_id = ?
			JOIN api_keys k ON k.api_key = km.api_key AND k.enabled = 1 AND k.key_group = 'normal'
			JOIN key_providers kp ON kp.api_key = k.api_key
			JOIN providers p ON p.id = kp.provider_id AND p.enabled = 1
			ORDER BY km.model
		`;
		bindings = [endpointId];
	} else {
		query = `
			SELECT DISTINCT km.model
			FROM key_models km
			JOIN api_keys k ON k.api_key = km.api_key AND k.enabled = 1 AND k.key_group = 'normal'
			JOIN key_providers kp ON kp.api_key = k.api_key
			JOIN providers p ON p.id = kp.provider_id AND p.enabled = 1
			ORDER BY km.model
		`;
	}
	const rows = Array.from(sql.exec(query, ...bindings).raw<[string]>());
	const models = rows.map((r: [string]) => r[0]);
	modelsCache.set(cacheKey, { data: models, ts: Date.now() });
	return models;
}
