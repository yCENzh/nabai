import { BASE_URL, maskKey } from '../core/utils';

// ─── Providers ───

export async function handleGetProviders(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const results = sql.exec('SELECT id, type, name, base_url, enabled, config_json, in_default_rotation FROM providers ORDER BY created_at').raw<any>();
		const providers = Array.from(results).map((row: any) => ({
			id: row[0], type: row[1], name: row[2], base_url: row[3],
			enabled: row[4] === 1, config_json: row[5], in_default_rotation: row[6] === 1,
		}));
		return jsonResponse({ providers });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertProvider(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const body = await request.json();
		const { id, type, name, base_url, enabled, config_json, in_default_rotation } = body as any;
		if (!id || !type || !name || !base_url) {
			return jsonResponse({ error: 'id, type, name, base_url 是必填项' }, 400);
		}
		const rotation = in_default_rotation ? 1 : 0;
		sql.exec(
			`INSERT INTO providers (id, type, name, base_url, enabled, config_json, in_default_rotation, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
			 ON CONFLICT(id) DO UPDATE SET type=excluded.type, name=excluded.name, base_url=excluded.base_url, enabled=excluded.enabled, config_json=excluded.config_json, in_default_rotation=excluded.in_default_rotation, updated_at=unixepoch()`,
			id, type, name, base_url, enabled !== false ? 1 : 0, config_json ?? '{}', rotation
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
		sql.exec('DELETE FROM api_keys WHERE provider_id = ?', id);
		sql.exec('DELETE FROM providers WHERE id = ?', id);
		return jsonResponse({ message: 'Provider 及其关联密钥已删除。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

// ─── API Keys (with provider association) ───

export async function handleApiKeys(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { keys, provider_id, model, health_check_enabled, in_default_rotation } = (await request.json()) as {
			keys: string[]; provider_id?: string; model?: string; health_check_enabled?: boolean; in_default_rotation?: boolean;
		};
		if (!Array.isArray(keys) || keys.length === 0) {
			return jsonResponse({ error: '请求体无效，需要一个包含key的非空数组。' }, 400);
		}

		if (!provider_id) {
			return jsonResponse({ error: 'provider_id 是必填项' }, 400);
		}
		if (!model) {
			return jsonResponse({ error: 'model 是必填项' }, 400);
		}
		const normalizedModel = model.replace(/[,，;；|、\s]+/g, ',').replace(/^,|,$/g, '');
		if (!normalizedModel) {
			return jsonResponse({ error: 'model 是必填项' }, 400);
		}
		const hce = health_check_enabled !== false ? 1 : 0;
		const rotation = in_default_rotation ? 1 : 0;
		let added = 0;
		let skipped = 0;
		for (const key of keys) {
			const existing = Array.from(sql.exec('SELECT 1 FROM api_keys WHERE api_key = ?', key).raw<any>());
			if (existing.length > 0) { skipped++; continue; }
			const keyId = crypto.randomUUID();
			sql.exec('INSERT INTO api_keys (id, provider_id, model, api_key, health_check_enabled, in_default_rotation) VALUES (?, ?, ?, ?, ?, ?)', keyId, provider_id, normalizedModel, key, hce, rotation);
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
		const { api_key, provider_id, model, health_check_enabled, in_default_rotation } = (await request.json()) as {
			api_key: string; provider_id?: string; model?: string; health_check_enabled?: boolean; in_default_rotation?: boolean;
		};
		if (!api_key) return jsonResponse({ error: 'api_key 是必填项' }, 400);
		if (!provider_id) return jsonResponse({ error: 'provider_id 是必填项' }, 400);
		if (!model) return jsonResponse({ error: 'model 是必填项' }, 400);
		const normalizedModel = model.replace(/[,，;；|、\s]+/g, ',').replace(/^,|,$/g, '');
		if (!normalizedModel) return jsonResponse({ error: 'model 是必填项' }, 400);

		sql.exec(
			'UPDATE api_keys SET provider_id = ?, model = ?, health_check_enabled = ?, in_default_rotation = ? WHERE api_key = ?',
			provider_id, normalizedModel, health_check_enabled !== false ? 1 : 0, in_default_rotation ? 1 : 0, api_key
		);
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
			SELECT k.api_key, p.type, p.name, p.base_url, k.model
			FROM api_keys k
			JOIN providers p ON p.id = k.provider_id
			WHERE p.enabled = 1
		`).raw<any>();
		const providerMap = new Map<string, { type: string; name: string; baseUrl: string; model: string }>();
		for (const row of Array.from(keyProviderRows)) {
			providerMap.set(row[0] as string, { type: row[1] as string, name: row[2] as string, baseUrl: row[3] as string, model: row[4] as string });
		}

		const checkResults = await Promise.all(
			keys.map(async (key) => {
				try {
					const provider = providerMap.get(key);
					const providerType = provider?.type || 'gemini';
					const providerName = provider?.name || '';
					const baseUrl = (provider?.baseUrl || BASE_URL).replace(/\/+$/, '');
					const modelList = (provider?.model || '').split(',').map(m => m.trim()).filter(Boolean);
					const model = modelList[Math.floor(Math.random() * modelList.length)] || '';

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

		for (const result of checkResults) {
			if (result.valid) {
				sql.exec("UPDATE api_keys SET key_group = 'normal' WHERE api_key = ?", result.key);
			} else {
				sql.exec("UPDATE api_keys SET key_group = 'abnormal' WHERE api_key = ?", result.key);
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
			.exec(`SELECT api_key, key_group, provider_id, model, health_check_enabled, enabled, in_default_rotation
				   FROM api_keys
				   LIMIT ? OFFSET ?`, pageSize, offset)
			.raw<any>();
		const keys = results
			? Array.from(results).map((row: any) => ({
					api_key: row[0], key_group: row[1], provider_id: row[2],
					model: row[3] || '', health_check_enabled: row[4] === 1, enabled: row[5] === 1,
					in_default_rotation: row[6] === 1,
			  }))
			: [];

		return jsonResponse({ keys, total });
	} catch (error: any) {
		console.error('获取API密钥失败:', error);
		return jsonResponse({ error: error.message || '内部服务器错误' }, 500);
	}
}

// ─── Endpoints ───

export async function handleGetEndpoints(sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const results = sql.exec('SELECT id, path, provider_id, enabled FROM endpoints ORDER BY created_at').raw<any>();
		const endpoints = Array.from(results).map((row: any) => ({
			id: row[0], path: row[1], provider_id: row[2], enabled: row[3] === 1,
		}));
		return jsonResponse({ endpoints });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleUpsertEndpoint(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { id, path, provider_id, enabled } = (await request.json()) as any;
		if (!id || !path) {
			return jsonResponse({ error: 'id, path 是必填项' }, 400);
		}
		if (!provider_id) {
			return jsonResponse({ error: 'provider_id 是必填项' }, 400);
		}
		sql.exec(
			`INSERT INTO endpoints (id, path, provider_id, enabled, updated_at)
			 VALUES (?, ?, ?, ?, unixepoch())
			 ON CONFLICT(id) DO UPDATE SET path=excluded.path, provider_id=excluded.provider_id, enabled=excluded.enabled, updated_at=unixepoch()`,
			id, path, provider_id, enabled !== false ? 1 : 0
		);
		return jsonResponse({ message: '端点保存成功。' });
	} catch (error: any) {
		return jsonResponse({ error: error.message }, 500);
	}
}

export async function handleDeleteEndpoint(request: Request, sql: DurableObjectStorage['sql']): Promise<Response> {
	try {
		const { id } = (await request.json()) as any;
		if (!id) return jsonResponse({ error: 'id 是必填项' }, 400);
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
			sql.exec('SELECT id, type, name, base_url, enabled, config_json, in_default_rotation FROM providers ORDER BY created_at').raw<any>()
		).map((r: any) => ({ id: r[0], type: r[1], name: r[2], base_url: r[3], enabled: r[4] === 1, config_json: r[5], in_default_rotation: r[6] === 1 }));

		const keys = Array.from(
			sql.exec('SELECT k.provider_id, k.model, k.api_key, k.enabled, k.health_check_enabled, k.in_default_rotation FROM api_keys k ORDER BY created_at').raw<any>()
		).map((r: any) => ({ provider_id: r[0], model: r[1], api_key: r[2], enabled: r[3] === 1, health_check_enabled: r[4] === 1, in_default_rotation: r[5] === 1 }));

		const endpoints = Array.from(
			sql.exec('SELECT id, path, provider_id, enabled FROM endpoints ORDER BY created_at').raw<any>()
		).map((r: any) => ({ id: r[0], path: r[1], provider_id: r[2], enabled: r[3] === 1 }));

		return jsonResponse({ version: 1, providers, keys, endpoints, exported_at: new Date().toISOString() });
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

		sql.exec('DELETE FROM api_keys');
		sql.exec('DELETE FROM providers');
		sql.exec('DELETE FROM endpoints');

		for (const p of data.providers) {
			if (!p.id || !p.type || !p.name || !p.base_url) continue;
			sql.exec(
				'INSERT INTO providers (id, type, name, base_url, enabled, config_json, in_default_rotation) VALUES (?, ?, ?, ?, ?, ?, ?)',
				p.id, p.type, p.name, p.base_url, p.enabled !== false ? 1 : 0, p.config_json ?? '{}', p.in_default_rotation ? 1 : 0
			);
		}

		for (const k of data.keys) {
			if (!k.api_key) continue;
			const keyId = crypto.randomUUID();
			sql.exec(
				'INSERT INTO api_keys (id, provider_id, model, api_key, enabled, health_check_enabled, in_default_rotation) VALUES (?, ?, ?, ?, ?, ?, ?)',
				keyId, k.provider_id ?? '', k.model ?? '', k.api_key, k.enabled !== false ? 1 : 0, k.health_check_enabled !== false ? 1 : 0, k.in_default_rotation ? 1 : 0
			);
		}

		for (const ep of data.endpoints) {
			if (!ep.id || !ep.path) continue;
			sql.exec(
				'INSERT INTO endpoints (id, path, provider_id, enabled) VALUES (?, ?, ?, ?)',
				ep.id, ep.path, ep.provider_id ?? '', ep.enabled !== false ? 1 : 0
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
