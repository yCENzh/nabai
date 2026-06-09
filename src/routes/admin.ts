import { BASE_URL, maskKey } from '../core/utils';

// ─── Providers ───

export async function handleGetProviders(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const results = sql.exec('SELECT id, type, name, base_url, enabled, config_json FROM providers ORDER BY created_at').raw<any>();
		const providers = Array.from(results).map((row: any) => ({
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
		const body = await request.json();
		const { id, type, name, base_url, enabled, config_json } = body as any;
		if (!id || !type || !name || !base_url) {
			return jsonResponse({ error: 'id, type, name, base_url 是必填项' }, 400);
		}
		sql.exec(
			`INSERT INTO providers (id, type, name, base_url, enabled, config_json, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, unixepoch())
			 ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, base_url=excluded.base_url, enabled=excluded.enabled, config_json=excluded.config_json, updated_at=unixepoch()`,
			id, type, name, base_url, enabled !== false ? 1 : 0, config_json ?? '{}'
		);
		return jsonResponse({ message: 'Provider 保存成功。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteProvider(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { id } = (await request.json()) as any;
		if (!id) return jsonResponse({ error: 'id 是必填项' }, 400);

		// 找出只关联了这个 provider 的密钥
		const soleKeys = Array.from(sql.exec(`
			SELECT kp.api_key FROM key_providers kp
			WHERE kp.provider_id = ?
			AND (SELECT COUNT(*) FROM key_providers kp2 WHERE kp2.api_key = kp.api_key) = 1
		`, id).raw<any>()).map((r: any) => r[0]);

		if (soleKeys.length > 0) {
			// 删除这些密钥及其关联数据
			const placeholders = soleKeys.map(() => '?').join(',');
			sql.exec(`DELETE FROM key_models WHERE api_key IN (${placeholders})`, ...soleKeys);
			sql.exec(`DELETE FROM key_providers WHERE api_key IN (${placeholders})`, ...soleKeys);
			sql.exec(`DELETE FROM api_keys WHERE api_key IN (${placeholders})`, ...soleKeys);
		}

		// 删除该 provider 与其他密钥的关联
		sql.exec('DELETE FROM key_providers WHERE provider_id = ?', id);
		sql.exec('DELETE FROM providers WHERE id = ?', id);
		return jsonResponse({
			message: `Provider 已删除。${soleKeys.length > 0 ? `同时删除了 ${soleKeys.length} 个仅关联此 Provider 的密钥。` : ''}`,
			deletedKeys: soleKeys.length,
		});
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── API Keys (with provider association) ───

export async function handleApiKeys(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
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
		for (const key of keys) {
			const existing = Array.from(sql.exec('SELECT 1 FROM api_keys WHERE api_key = ?', key).raw<any>());
			if (existing.length > 0) { skipped++; continue; }
			const keyId = crypto.randomUUID();
			sql.exec('INSERT INTO api_keys (id, api_key, health_check_enabled) VALUES (?, ?, ?)', keyId, key, hce);
			for (const pid of provider_ids) {
				sql.exec('INSERT OR IGNORE INTO key_providers (id, api_key, provider_id) VALUES (?, ?, ?)', crypto.randomUUID(), key, pid);
			}
			added++;
		}
		if (added === 0) {
			return jsonResponse({ error: '密钥已存在，未添加任何新密钥。' }, 409);
		}
		return jsonResponse({ message: `成功添加 ${added} 个密钥` + (skipped ? `，${skipped} 个已存在跳过` : '') + '。' });
	} catch (error: any) {
		console.error('处理API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleUpdateApiKey(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { api_key, provider_ids, health_check_enabled } = (await request.json()) as {
			api_key: string; provider_ids?: string[]; health_check_enabled?: boolean;
		};
		if (!api_key) return jsonResponse({ error: 'api_key 是必填项' }, 400);
		if (!Array.isArray(provider_ids) || provider_ids.length === 0) return jsonResponse({ error: '至少选择一个 Provider' }, 400);
		sql.exec(
			'UPDATE api_keys SET health_check_enabled = ? WHERE api_key = ?',
			health_check_enabled !== false ? 1 : 0, api_key
		);
		sql.exec('DELETE FROM key_providers WHERE api_key = ?', api_key);
		for (const pid of provider_ids) {
			sql.exec('INSERT OR IGNORE INTO key_providers (id, api_key, provider_id) VALUES (?, ?, ?)', crypto.randomUUID(), api_key, pid);
		}
		return jsonResponse({ message: '密钥更新成功。' });
	} catch (error: any) {
		console.error('更新密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleDeleteApiKeys(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { keys } = (await request.json()) as { keys: string[] };
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}

		const batchSize = 500;
		for (let i = 0; i < keys.length; i += batchSize) {
			const batch = keys.slice(i, i + batchSize);
			const placeholders = batch.map(() => '?').join(',');
			sql.exec(`DELETE FROM key_models WHERE api_key IN (${placeholders})`, ...batch);
			sql.exec(`DELETE FROM key_providers WHERE api_key IN (${placeholders})`, ...batch);
			sql.exec(`DELETE FROM api_keys WHERE api_key IN (${placeholders})`, ...batch);
		}

		return jsonResponse({ message: 'API密钥删除成功。' });
	} catch (error: any) {
		console.error('删除API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleToggleApiKeys(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { keys, enabled } = (await request.json()) as { keys: string[]; enabled: boolean };
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}
		const val = enabled ? 1 : 0;
		const batchSize = 500;
		for (let i = 0; i < keys.length; i += batchSize) {
			const batch = keys.slice(i, i + batchSize);
			const placeholders = batch.map(() => '?').join(',');
			sql.exec(`UPDATE api_keys SET enabled = ? WHERE api_key IN (${placeholders})`, val, ...batch);
		}
		return jsonResponse({ message: `已${enabled ? '启用' : '禁用'} ${keys.length} 个密钥。` });
	} catch (error: any) {
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function handleApiKeysCheck(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { keys } = (await request.json()) as { keys: string[] };
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}

		// Build a map of api_key → { type, base_url, model } from providers
		const keyProviderRows = sql.exec(`
			SELECT k.api_key, p.type, p.name, p.base_url, GROUP_CONCAT(m.model) as models
			FROM api_keys k
			JOIN key_providers kp ON kp.api_key = k.api_key
			JOIN providers p ON p.id = kp.provider_id
			LEFT JOIN key_models m ON m.api_key = k.api_key
			WHERE p.enabled = 1
			GROUP BY k.api_key, p.type, p.name, p.base_url
		`).raw<any>();
				const providerMap = new Map<string, { type: string; name: string; baseUrl: string; models: string }>();
		for (const row of Array.from(keyProviderRows)) {
			providerMap.set(row[0] as string, { type: row[1] as string, name: row[2] as string, baseUrl: row[3] as string, models: row[4] || '' });
		}

		const checkResults = await Promise.all(
			keys.map(async (key) => {
				try {
					const provider = providerMap.get(key);
					const providerType = provider?.type || 'gemini';
					const providerName = provider?.name || '';
					const baseUrl = (provider?.baseUrl || BASE_URL).replace(/\/+$/, '');
					const modelList = (provider?.models || '').split(',').filter(Boolean);
					const model = modelList.length > 0 ? modelList[Math.floor(Math.random() * modelList.length)] : '';

					if (!model) {
						return { key, valid: true, skipped: true };
					}

					let response: Response;
					if (providerType === 'gemini') {
						response = await fetch(`${baseUrl}/v1beta/models/${model}:generateContent?key=${key}`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
						});
					} else if (providerType === 'anthropic') {
						const body = { model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };
						response = await fetch(`${baseUrl}/v1/messages`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
							body: JSON.stringify(body),
						});
					} else {
						response = await fetch(`${baseUrl}/chat/completions`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
							body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
						});
					}
					if (!response.ok) {
						console.log(`[health] FAIL key=${maskKey(key)} provider=${providerName}(${providerType}) model=${model} status=${response.status}`);
					}
					return { key, valid: response.ok, error: response.ok ? null : await response.text() };
				} catch (e: any) {
					console.log(`[health] ERROR key=${maskKey(key)} error=${e.message}`);
					return { key, valid: false, error: e.message };
				}
			})
		);

		const currentGroups = new Map(
			Array.from(sql.exec(
				`SELECT api_key, key_group FROM api_keys WHERE api_key IN (${keys.map(() => '?').join(',')})`,
				...keys
			).raw<any>()).map((r: any) => [r[0], r[1]])
		);
		for (const result of checkResults) {
			if (result.skipped) continue;
			const target = result.valid ? 'normal' : 'abnormal';
			if (currentGroups.get(result.key) !== target) {
				sql.exec("UPDATE api_keys SET key_group = ? WHERE api_key = ?", target, result.key);
			}
		}

		return jsonResponse(checkResults);
	} catch (error: any) {
		console.error('检查API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

export async function getAllApiKeys(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const url = new URL(request.url);
		const page = parseInt(url.searchParams.get('page') || '1', 10);
		const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
		const offset = (page - 1) * pageSize;

		const totalResult = sql.exec('SELECT COUNT(*) as count FROM api_keys').raw<any>();
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
				   LIMIT ? OFFSET ?`, pageSize, offset)
			.raw<any>();
		const keys = results
			? Array.from(results).map((row: any) => ({
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
		`).raw<any>());
		const models = rows.map((row: any) => ({
			model: row[0],
			keys: row[1] ? row[1].split(',') : [],
		}));
		return jsonResponse({ models });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertModel(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { model, keys } = (await request.json()) as { model?: string; keys?: string[] };
		if (!model) return jsonResponse({ error: 'model 是必填项' }, 400);
		if (!Array.isArray(keys) || keys.length === 0) return jsonResponse({ error: '至少选择一个密钥' }, 400);

		sql.exec('DELETE FROM key_models WHERE model = ?', model);
		for (const apiKey of keys) {
			sql.exec('INSERT INTO key_models (id, model, api_key) VALUES (?, ?, ?)', crypto.randomUUID(), model, apiKey);
		}
		return jsonResponse({ message: `模型 "${model}" 已绑定 ${keys.length} 个密钥。` });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteModel(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { model } = (await request.json()) as { model?: string };
		if (!model) return jsonResponse({ error: 'model 是必填项' }, 400);
		sql.exec('DELETE FROM key_models WHERE model = ?', model);
		return jsonResponse({ message: `模型 "${model}" 已删除。` });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── Endpoints ───

export async function handleGetEndpoints(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const endpoints = Array.from(sql.exec('SELECT id, path, enabled FROM endpoints ORDER BY created_at').raw<any>())
			.map((row: any) => ({ id: row[0], path: row[1], enabled: row[2] === 1 }));
		for (const ep of endpoints) {
			const models = Array.from(sql.exec('SELECT model FROM endpoint_models WHERE endpoint_id = ?', ep.id).raw<any>())
				.map((r: any) => r[0]);
			(ep as any).models = models;
		}
		return jsonResponse({ endpoints });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertEndpoint(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { id, path, models, enabled } = (await request.json()) as any;
		if (!id || !path) {
			return jsonResponse({ error: 'id, path 是必填项' }, 400);
		}
		sql.exec(
			`INSERT INTO endpoints (id, path, enabled, updated_at)
			 VALUES (?, ?, ?, unixepoch())
			 ON CONFLICT(id) DO UPDATE SET path=excluded.path, enabled=excluded.enabled, updated_at=unixepoch()`,
			id, path, enabled !== false ? 1 : 0
		);
		sql.exec('DELETE FROM endpoint_models WHERE endpoint_id = ?', id);
		if (Array.isArray(models)) {
			for (const model of models) {
				sql.exec('INSERT OR IGNORE INTO endpoint_models (id, endpoint_id, model) VALUES (?, ?, ?)', crypto.randomUUID(), id, model);
			}
		}
		return jsonResponse({ message: '端点保存成功。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteEndpoint(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { id } = (await request.json()) as any;
		if (!id) return jsonResponse({ error: 'id 是必填项' }, 400);
		if (id === 'default') return jsonResponse({ error: '默认端点不可删除' }, 400);
		sql.exec('DELETE FROM endpoint_models WHERE endpoint_id = ?', id);
		sql.exec('DELETE FROM endpoints WHERE id = ?', id);
		return jsonResponse({ message: '端点已删除。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── Backup / Restore ───

export async function handleBackup(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const providers = Array.from(
			sql.exec('SELECT id, type, name, base_url, enabled, config_json FROM providers ORDER BY created_at').raw<any>()
		).map((r: any) => ({ id: r[0], type: r[1], name: r[2], base_url: r[3], enabled: r[4] === 1, config_json: r[5] }));

		const keys = Array.from(
			sql.exec('SELECT api_key, enabled, health_check_enabled FROM api_keys ORDER BY created_at').raw<any>()
		).map((r: any) => ({ api_key: r[0], enabled: r[1] === 1, health_check_enabled: r[2] === 1 }));

		const keyProviders = Array.from(
			sql.exec('SELECT api_key, provider_id FROM key_providers ORDER BY created_at').raw<any>()
		).map((r: any) => ({ api_key: r[0], provider_id: r[1] }));

		const keyModels = Array.from(
			sql.exec('SELECT model, api_key FROM key_models ORDER BY created_at').raw<any>()
		).map((r: any) => ({ model: r[0], api_key: r[1] }));

		const endpointModels = Array.from(
			sql.exec('SELECT endpoint_id, model FROM endpoint_models ORDER BY created_at').raw<any>()
		).map((r: any) => ({ endpoint_id: r[0], model: r[1] }));

		const endpoints = Array.from(
			sql.exec('SELECT id, path, enabled FROM endpoints ORDER BY created_at').raw<any>()
		).map((r: any) => ({ id: r[0], path: r[1], enabled: r[2] === 1 }));

		return jsonResponse({ version: 3, providers, keys, keyProviders, keyModels, endpointModels, endpoints, exported_at: new Date().toISOString() });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleRestore(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const data = await request.json() as any;
		if (!data || !Array.isArray(data.providers) || !Array.isArray(data.keys) || !Array.isArray(data.endpoints)) {
			return jsonResponse({ error: '格式无效：需要 providers, keys, endpoints 数组' }, 400);
		}

		sql.exec('DELETE FROM endpoint_models');
		sql.exec('DELETE FROM key_models');
		sql.exec('DELETE FROM key_providers');
		sql.exec('DELETE FROM api_keys');
		sql.exec('DELETE FROM providers');
		sql.exec('DELETE FROM endpoints');

		for (const p of data.providers) {
			if (!p.id || !p.type || !p.name || !p.base_url) continue;
			sql.exec(
				'INSERT INTO providers (id, type, name, base_url, enabled, config_json) VALUES (?, ?, ?, ?, ?, ?)',
				p.id, p.type, p.name, p.base_url, p.enabled !== false ? 1 : 0, p.config_json ?? '{}'
			);
		}

		for (const k of data.keys) {
			if (!k.api_key) continue;
			const keyId = crypto.randomUUID();
			sql.exec(
				'INSERT INTO api_keys (id, api_key, enabled, health_check_enabled) VALUES (?, ?, ?, ?)',
				keyId, k.api_key, k.enabled !== false ? 1 : 0, k.health_check_enabled !== false ? 1 : 0
			);
		}

		if (Array.isArray(data.keyProviders)) {
			for (const kp of data.keyProviders) {
				if (!kp.api_key || !kp.provider_id) continue;
				sql.exec('INSERT INTO key_providers (id, api_key, provider_id) VALUES (?, ?, ?)', crypto.randomUUID(), kp.api_key, kp.provider_id);
			}
		}

		if (Array.isArray(data.keyModels)) {
			for (const km of data.keyModels) {
				if (!km.model || !km.api_key) continue;
				sql.exec('INSERT INTO key_models (id, model, api_key) VALUES (?, ?, ?)', crypto.randomUUID(), km.model, km.api_key);
			}
		}

		if (Array.isArray(data.endpointModels)) {
			for (const em of data.endpointModels) {
				if (!em.endpoint_id || !em.model) continue;
				sql.exec('INSERT INTO endpoint_models (id, endpoint_id, model) VALUES (?, ?, ?)', crypto.randomUUID(), em.endpoint_id, em.model);
			}
		}

		for (const ep of data.endpoints) {
			if (!ep.id || !ep.path) continue;
			sql.exec(
				'INSERT INTO endpoints (id, path, enabled) VALUES (?, ?, ?)',
				ep.id, ep.path, ep.enabled !== false ? 1 : 0
			);
		}

		return jsonResponse({ message: '恢复成功。', providers: data.providers.length, keys: data.keys.length, endpoints: data.endpoints.length });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── Helpers ───

function jsonResponse(data: any, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
