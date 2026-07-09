// ─── 类型辅助 ───

const VALID_PROVIDER_TYPES = new Set(['gemini', 'openai_compat', 'anthropic']);

function validateId(id: string): boolean {
	return /^[a-zA-Z0-9_-]+$/.test(id);
}

function validateUrl(url: string): boolean {
	try { new URL(url); return true; } catch { return false; }
}

/** SQL 行类型：providers 表（SELECT 常用列） */
type ProviderRow = [string, string, string, string, number, string];
/** SQL 行类型：api_keys 表（SELECT：api_key, enabled, health_check_enabled, key_group） */
type ApiKeyRow = [string, number, number, string];
/** SQL 行类型：endpoints 表（SELECT 常用列） */
type EndpointRow = [string, number];
/** SQL 行类型：key_providers / key_models / endpoint_models 关联表 */
type KeyRefRow = [string, string];
/** SQL 行类型：聚合查询（GROUP_CONCAT） */
type AggRow = [string, string | null];

// ─── 请求体类型 ───

interface UpsertProviderBody {
	id: string; type: string; name: string; base_url: string;
	enabled?: boolean; config_json?: string;
}
interface ApiKeysBody {
	keys: string[]; provider_ids?: string[]; health_check_enabled?: boolean;
}
interface UpdateApiKeyBody {
	api_key: string; provider_ids?: string[]; health_check_enabled?: boolean;
}
interface ToggleApiKeysBody {
	keys: string[]; enabled: boolean;
}
interface DeleteBody {
	id?: string;
}
interface DeleteKeysBody {
	keys: string[];
}
interface UpsertModelBody {
	model?: string; keys?: string[];
}
interface UpsertEndpointBody {
	id?: string; models?: string[]; enabled?: boolean;
}
interface BackupData {
	providers: Array<{ id: string; type: string; name: string; base_url: string; enabled: boolean; config_json: string }>;
	keys: Array<{ api_key: string; enabled: boolean; health_check_enabled: boolean; key_group: string }>;
	endpoints: Array<{ id: string; enabled: boolean }>;
	keyProviders?: Array<{ api_key: string; provider_id: string }>;
	keyModels?: Array<{ model: string; api_key: string }>;
	endpointModels?: Array<{ endpoint_id: string; model: string }>;
}

// ─── Providers ───

export async function handleGetProviders(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const results = sql.exec('SELECT id, type, name, base_url, enabled, config_json FROM providers ORDER BY created_at').raw<ProviderRow>();
		const providers = Array.from(results).map((row: ProviderRow) => ({
			id: row[0], type: row[1], name: row[2], base_url: row[3],
			enabled: row[4] === 1, config_json: row[5],
		}));
		return jsonResponse({ providers });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertProvider(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const body = await request.json() as UpsertProviderBody;
		const { id, type, name, base_url, enabled, config_json } = body;
		if (!id || !type || !name || !base_url) {
			return jsonResponse({ error: 'id, type, name, base_url 是必填项' }, 400);
		}
		if (!validateId(id)) {
			return jsonResponse({ error: 'ID 只能包含英文字母、数字、下划线和连字符' }, 400);
		}
		if (!VALID_PROVIDER_TYPES.has(type)) {
			return jsonResponse({ error: `无效的 Provider 类型，支持：${Array.from(VALID_PROVIDER_TYPES).join(', ')}` }, 400);
		}
		const cleanUrl = base_url.replace(/\/+$/, '');
		if (!validateUrl(cleanUrl)) {
			return jsonResponse({ error: 'base_url 不是合法的 URL' }, 400);
		}
		if (config_json) {
			try { JSON.parse(config_json); } catch { return jsonResponse({ error: 'config_json 不是合法的 JSON' }, 400); }
		}
		sql.exec(
			`INSERT INTO providers (id, type, name, base_url, enabled, config_json, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, unixepoch())
			 ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, base_url=excluded.base_url, enabled=excluded.enabled, config_json=excluded.config_json, updated_at=unixepoch()`,
			id, type, name, cleanUrl, enabled !== false ? 1 : 0, config_json ?? '{}'
		);
		return jsonResponse({ message: 'Provider 保存成功。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteProvider(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { id } = await request.json() as DeleteBody;
		if (!id) return jsonResponse({ error: 'id 是必填项' }, 400);

		const soleKeys = Array.from(storage.sql.exec(`
			SELECT kp.api_key FROM key_providers kp
			WHERE kp.provider_id = ?
			AND (SELECT COUNT(*) FROM key_providers kp2 WHERE kp2.api_key = kp.api_key) = 1
		`, id).raw<KeyRefRow>()).map((r: KeyRefRow) => r[0]);

		storage.transactionSync(() => {
			if (soleKeys.length > 0) {
				const placeholders = soleKeys.map(() => '?').join(',');
				storage.sql.exec(`DELETE FROM key_models WHERE api_key IN (${placeholders})`, ...soleKeys);
				storage.sql.exec(`DELETE FROM key_providers WHERE api_key IN (${placeholders})`, ...soleKeys);
				storage.sql.exec(`DELETE FROM api_keys WHERE api_key IN (${placeholders})`, ...soleKeys);
			}

			storage.sql.exec('DELETE FROM key_providers WHERE provider_id = ?', id);
			storage.sql.exec('DELETE FROM providers WHERE id = ?', id);
			// 清理悬空的 endpoint model 绑定
			storage.sql.exec('DELETE FROM endpoint_models WHERE model NOT IN (SELECT DISTINCT model FROM key_models)');
		});

		return jsonResponse({
			message: `Provider 已删除。${soleKeys.length > 0 ? `同时删除了 ${soleKeys.length} 个仅关联此 Provider 的密钥。` : ''}`,
			deletedKeys: soleKeys.length,
		});
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── API Keys (with provider association) ───

export async function handleApiKeys(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { keys, provider_ids, health_check_enabled } = (await request.json()) as {
			keys: string[]; provider_ids?: string[]; health_check_enabled?: boolean;
		};
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}
		if (!Array.isArray(provider_ids) || provider_ids.length === 0) {
			return jsonResponse({ error: '至少选择一个 Provider' }, 400);
		}
		const hce = health_check_enabled !== false ? 1 : 0;
		let added = 0;
		let skipped = 0;
		storage.transactionSync(() => {
			for (const key of keys) {
				if (typeof key !== 'string' || !key.trim()) continue;
				const existing = Array.from(storage.sql.exec('SELECT 1 FROM api_keys WHERE api_key = ?', key).raw<[number]>());
				if (existing.length > 0) { skipped++; continue; }
				const keyId = crypto.randomUUID();
				storage.sql.exec('INSERT INTO api_keys (id, api_key, health_check_enabled) VALUES (?, ?, ?)', keyId, key, hce);
				for (const pid of provider_ids) {
					storage.sql.exec('INSERT OR IGNORE INTO key_providers (id, api_key, provider_id) VALUES (?, ?, ?)', crypto.randomUUID(), key, pid);
				}
				added++;
			}
		});
		if (added === 0) {
			return jsonResponse({ error: '密钥已存在，未添加任何新密钥。' }, 409);
		}
		return jsonResponse({ message: `成功添加 ${added} 个密钥` + (skipped ? `，${skipped} 个已存在跳过` : '') + '。' });
	} catch (error: any) {
		console.error('处理API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleUpdateApiKey(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { api_key, provider_ids, health_check_enabled } = (await request.json()) as {
			api_key: string; provider_ids?: string[]; health_check_enabled?: boolean;
		};
		if (!api_key) return jsonResponse({ error: 'api_key 是必填项' }, 400);
		if (!Array.isArray(provider_ids) || provider_ids.length === 0) return jsonResponse({ error: '至少选择一个 Provider' }, 400);

		storage.transactionSync(() => {
			storage.sql.exec(
				'UPDATE api_keys SET health_check_enabled = ? WHERE api_key = ?',
				health_check_enabled !== false ? 1 : 0, api_key
			);
			storage.sql.exec('DELETE FROM key_providers WHERE api_key = ?', api_key);
			for (const pid of provider_ids) {
				storage.sql.exec('INSERT OR IGNORE INTO key_providers (id, api_key, provider_id) VALUES (?, ?, ?)', crypto.randomUUID(), api_key, pid);
			}
		});

		return jsonResponse({ message: '密钥更新成功。' });
	} catch (error: any) {
		console.error('更新密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleDeleteApiKeys(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { keys } = (await request.json()) as { keys: string[] };
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}

		storage.transactionSync(() => {
			const batchSize = 500;
			for (let i = 0; i < keys.length; i += batchSize) {
				const batch = keys.slice(i, i + batchSize);
				const placeholders = batch.map(() => '?').join(',');
				storage.sql.exec(`DELETE FROM key_models WHERE api_key IN (${placeholders})`, ...batch);
				storage.sql.exec(`DELETE FROM key_providers WHERE api_key IN (${placeholders})`, ...batch);
				storage.sql.exec(`DELETE FROM api_keys WHERE api_key IN (${placeholders})`, ...batch);
			}
			// 清理悬空的 endpoint model 绑定
			storage.sql.exec('DELETE FROM endpoint_models WHERE model NOT IN (SELECT DISTINCT model FROM key_models)');
		});

		return jsonResponse({ message: 'API密钥删除成功。' });
	} catch (error: any) {
		console.error('删除API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleToggleApiKeys(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { keys, enabled } = (await request.json()) as { keys: string[]; enabled: boolean };
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}
		const val = enabled ? 1 : 0;
		storage.transactionSync(() => {
			const batchSize = 500;
			for (let i = 0; i < keys.length; i += batchSize) {
				const batch = keys.slice(i, i + batchSize);
				const placeholders = batch.map(() => '?').join(',');
				storage.sql.exec(`UPDATE api_keys SET enabled = ? WHERE api_key IN (${placeholders})`, val, ...batch);
			}
		});
		return jsonResponse({ message: `已${enabled ? '启用' : '禁用'} ${keys.length} 个密钥。` });
	} catch (error: any) {
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function getAllApiKeys(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const url = new URL(request.url);
		const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
		const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
		const offset = (page - 1) * pageSize;

		const totalResult = sql.exec('SELECT COUNT(*) as count FROM api_keys').raw<[number]>();
		const totalArray = Array.from(totalResult);
		const total = totalArray.length > 0 ? totalArray[0][0] : 0;

		const results = sql
			.exec(`SELECT k.api_key, k.key_group, k.health_check_enabled, k.enabled,
				   GROUP_CONCAT(DISTINCT kp.provider_id) as provider_ids,
				   GROUP_CONCAT(DISTINCT p.name) as provider_names
				   FROM api_keys k
				   LEFT JOIN key_providers kp ON kp.api_key = k.api_key
				   LEFT JOIN providers p ON p.id = kp.provider_id
				   GROUP BY k.api_key
				   ORDER BY k.api_key
				   LIMIT ? OFFSET ?`, pageSize, offset)
			.raw<[string, string, number, number, string | null, string | null]>();
		const keys = results
			? Array.from(results).map((row) => ({
					api_key: row[0], key_group: row[1],
					health_check_enabled: row[2] === 1, enabled: row[3] === 1,
					provider_ids: row[4] ? row[4].split(',') : [],
					provider_names: row[5] ? row[5].split(',') : [],
			  }))
			: [];

		return jsonResponse({ keys, total });
	} catch (error: any) {
		console.error('获取API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

// ─── Models ───

export async function handleGetModels(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const rows = Array.from(sql.exec(`
			SELECT m.model, GROUP_CONCAT(m.api_key) as keys
			FROM key_models m
			GROUP BY m.model
			ORDER BY MIN(m.created_at)
		`).raw<AggRow>());
		const models = rows.map((row: AggRow) => ({
			model: row[0],
			keys: row[1] ? row[1].split(',') : [],
		}));
		return jsonResponse({ models });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertModel(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { model, keys } = (await request.json()) as { model?: string; keys?: string[] };
		if (!model) return jsonResponse({ error: 'model 是必填项' }, 400);
		if (!Array.isArray(keys) || keys.length === 0) return jsonResponse({ error: '至少选择一个密钥' }, 400);
		if (/[\s,，、　]/.test(model)) return jsonResponse({ error: '模型名称不能分隔符' }, 400);

		storage.transactionSync(() => {
			storage.sql.exec('DELETE FROM key_models WHERE model = ?', model);
			for (const apiKey of keys) {
				storage.sql.exec('INSERT INTO key_models (id, model, api_key) VALUES (?, ?, ?)', crypto.randomUUID(), model, apiKey);
			}
		});

		return jsonResponse({ message: `模型 "${model}" 已绑定 ${keys.length} 个密钥。` });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteModel(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { model } = (await request.json()) as { model?: string };
		if (!model) return jsonResponse({ error: 'model 是必填项' }, 400);
		storage.transactionSync(() => {
			storage.sql.exec('DELETE FROM key_models WHERE model = ?', model);
			storage.sql.exec('DELETE FROM endpoint_models WHERE model = ?', model);
		});
		return jsonResponse({ message: `模型 "${model}" 已删除。` });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── Endpoints ───

export async function handleGetEndpoints(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const endpoints: Array<{ id: string; enabled: boolean; models: string[] }> = Array.from(sql.exec('SELECT id, enabled FROM endpoints ORDER BY created_at').raw<EndpointRow>())
			.map((row) => ({ id: row[0], enabled: row[1] === 1, models: [] }));
		for (const ep of endpoints) {
			const models = Array.from(sql.exec('SELECT model FROM endpoint_models WHERE endpoint_id = ?', ep.id).raw<[string]>())
				.map((r: [string]) => r[0]);
			ep.models = models;
		}
		return jsonResponse({ endpoints });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertEndpoint(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { id, models, enabled } = await request.json() as UpsertEndpointBody;
		if (!id) {
			return jsonResponse({ error: 'id 是必填项' }, 400);
		}
		if (!validateId(id)) {
			return jsonResponse({ error: 'ID 只能包含英文字母、数字、下划线和连字符' }, 400);
		}

		storage.transactionSync(() => {
			storage.sql.exec(
				`INSERT INTO endpoints (id, enabled, updated_at)
				 VALUES (?, ?, unixepoch())
				 ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled, updated_at=unixepoch()`,
				id, enabled !== false ? 1 : 0
			);
			storage.sql.exec('DELETE FROM endpoint_models WHERE endpoint_id = ?', id);
			if (Array.isArray(models)) {
				for (const model of models) {
					storage.sql.exec('INSERT OR IGNORE INTO endpoint_models (id, endpoint_id, model) VALUES (?, ?, ?)', crypto.randomUUID(), id, model);
				}
			}
		});

		return jsonResponse({ message: '端点保存成功。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteEndpoint(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const { id } = await request.json() as DeleteBody;
		if (!id) return jsonResponse({ error: 'id 是必填项' }, 400);
		if (!validateId(id!)) return jsonResponse({ error: 'ID 只能包含英文字母、数字、下划线和连字符' }, 400);
		if (id === 'default') return jsonResponse({ error: '默认端点不可删除' }, 400);
		storage.transactionSync(() => {
			storage.sql.exec('DELETE FROM endpoint_models WHERE endpoint_id = ?', id);
			storage.sql.exec('DELETE FROM endpoints WHERE id = ?', id);
		});
		return jsonResponse({ message: '端点已删除。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── Backup / Restore ───

export async function handleBackup(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const providers = Array.from(
			sql.exec('SELECT id, type, name, base_url, enabled, config_json FROM providers ORDER BY created_at').raw<ProviderRow>()
		).map((r: ProviderRow) => ({ id: r[0], type: r[1], name: r[2], base_url: r[3], enabled: r[4] === 1, config_json: r[5] }));

		const keys = Array.from(
			sql.exec('SELECT api_key, enabled, health_check_enabled, key_group FROM api_keys ORDER BY created_at').raw<ApiKeyRow>()
		).map((r: ApiKeyRow) => ({ api_key: r[0], enabled: r[1] === 1, health_check_enabled: r[2] === 1, key_group: r[3] }));

		const keyProviders = Array.from(
			sql.exec('SELECT api_key, provider_id FROM key_providers ORDER BY created_at').raw<KeyRefRow>()
		).map((r: KeyRefRow) => ({ api_key: r[0], provider_id: r[1] }));

		const keyModels = Array.from(
			sql.exec('SELECT model, api_key FROM key_models ORDER BY created_at').raw<KeyRefRow>()
		).map((r: KeyRefRow) => ({ model: r[0], api_key: r[1] }));

		const endpointModels = Array.from(
			sql.exec('SELECT endpoint_id, model FROM endpoint_models ORDER BY created_at').raw<KeyRefRow>()
		).map((r: KeyRefRow) => ({ endpoint_id: r[0], model: r[1] }));

		const endpoints = Array.from(
			sql.exec('SELECT id, enabled FROM endpoints ORDER BY created_at').raw<EndpointRow>()
		).map((r: EndpointRow) => ({ id: r[0], enabled: r[1] === 1 }));

		return jsonResponse({ providers, keys, keyProviders, keyModels, endpointModels, endpoints, exported_at: new Date().toISOString() });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleRestore(request: Request, storage: DurableObjectStorage): Promise<Response> {
	try {
		const data = await request.json() as BackupData;
		if (!data || !Array.isArray(data.providers) || !Array.isArray(data.keys) || !Array.isArray(data.endpoints)) {
			return jsonResponse({ error: '格式无效：需要 providers, keys, endpoints 数组' }, 400);
		}
		if (data.providers.some(p => !p.id || !p.type || !p.name || !p.base_url)) {
			return jsonResponse({ error: 'providers 中包含不完整的条目' }, 400);
		}
		if (data.providers.some(p => !validateId(p.id))) {
			return jsonResponse({ error: 'providers ID 格式无效' }, 400);
		}
		if (data.providers.some(p => !VALID_PROVIDER_TYPES.has(p.type))) {
			return jsonResponse({ error: `无效的 Provider 类型` }, 400);
		}
		if (data.providers.some(p => !validateUrl(p.base_url))) {
			return jsonResponse({ error: 'base_url 不是合法的 URL' }, 400);
		}
		if (data.keys.some(k => !k.api_key)) {
			return jsonResponse({ error: 'keys 中包含不完整的条目' }, 400);
		}
		if (data.endpoints.some(ep => !ep.id)) {
			return jsonResponse({ error: 'endpoints 中包含不完整的条目' }, 400);
		}

		storage.transactionSync(() => {
			storage.sql.exec('DELETE FROM endpoint_models');
			storage.sql.exec('DELETE FROM key_models');
			storage.sql.exec('DELETE FROM key_providers');
			storage.sql.exec('DELETE FROM api_keys');
			storage.sql.exec('DELETE FROM providers');
			storage.sql.exec('DELETE FROM endpoints');

			// Ensure default endpoint always exists after restore
			storage.sql.exec("INSERT OR IGNORE INTO endpoints (id, enabled) VALUES ('default', 1)");

			for (const p of data.providers) {
				if (!p.id || !p.type || !p.name || !p.base_url) continue;
				storage.sql.exec(
					'INSERT INTO providers (id, type, name, base_url, enabled, config_json) VALUES (?, ?, ?, ?, ?, ?)',
					p.id, p.type, p.name, p.base_url, p.enabled !== false ? 1 : 0, p.config_json ?? '{}'
				);
			}

			for (const k of data.keys) {
				if (!k.api_key) continue;
				const keyId = crypto.randomUUID();
				storage.sql.exec(
					'INSERT INTO api_keys (id, api_key, enabled, health_check_enabled, key_group) VALUES (?, ?, ?, ?, ?)',
					keyId, k.api_key, k.enabled !== false ? 1 : 0, k.health_check_enabled !== false ? 1 : 0, k.key_group
				);
			}

			if (Array.isArray(data.keyProviders)) {
				for (const kp of data.keyProviders) {
					if (!kp.api_key || !kp.provider_id) continue;
					storage.sql.exec('INSERT INTO key_providers (id, api_key, provider_id) VALUES (?, ?, ?)', crypto.randomUUID(), kp.api_key, kp.provider_id);
				}
			}

			if (Array.isArray(data.keyModels)) {
				for (const km of data.keyModels) {
					if (!km.model || !km.api_key) continue;
					storage.sql.exec('INSERT OR IGNORE INTO key_models (id, model, api_key) VALUES (?, ?, ?)', crypto.randomUUID(), km.model, km.api_key);
				}
			}

			for (const ep of data.endpoints) {
				if (!ep.id) continue;
				storage.sql.exec(
					'INSERT OR IGNORE INTO endpoints (id, enabled) VALUES (?, ?)',
					ep.id, ep.enabled !== false ? 1 : 0
				);
			}

			if (Array.isArray(data.endpointModels)) {
				for (const em of data.endpointModels) {
					if (!em.endpoint_id || !em.model) continue;
					storage.sql.exec('INSERT INTO endpoint_models (id, endpoint_id, model) VALUES (?, ?, ?)', crypto.randomUUID(), em.endpoint_id, em.model);
				}
			}
		});

		return jsonResponse({
			message: '恢复成功。',
			providers: data.providers.length,
			keys: data.keys.length,
			models: (data.keyModels || []).length,
			endpoints: data.endpoints.length,
		});
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── Helpers ───

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
