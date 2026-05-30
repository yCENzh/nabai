import { maskKey } from '../core/utils';

export async function getRandomApiKey(sql: DurableObjectStorage['sql'], providerId?: string): Promise<string | null> {
	try {
		const where = providerId
			? 'WHERE provider_id = ? AND enabled = 1'
			: 'WHERE enabled = 1';
		const params = providerId ? [providerId] : [];

		let results = sql
			.exec(`SELECT api_key FROM api_keys ${where} AND key_group = 'normal' ORDER BY RANDOM() LIMIT 1`, ...params)
			.raw<any>();
		let keys = Array.from(results);
		if (keys && keys.length > 0) {
			const key = keys[0][0] as string;
			console.log(`Selected API Key from normal group: ${maskKey(key)}`);
			return key;
		}

		results = sql
			.exec(`SELECT api_key FROM api_keys ${where} AND key_group = 'abnormal' ORDER BY RANDOM() LIMIT 1`, ...params)
			.raw<any>();
		keys = Array.from(results);
		if (keys && keys.length > 0) {
			const key = keys[0][0] as string;
			console.log(`Selected API Key from abnormal group: ${maskKey(key)}`);
			return key;
		}

		if (providerId) {
			console.log(`No keys found for provider ${providerId}`);
		}
		return null;
	} catch (error) {
		console.error('Failed to get random API key:', error);
		return null;
	}
}

/** Build health check request based on provider type */
function buildHealthCheckRequest(providerType: string, baseUrl: string, model?: string): { url: string; method: string; headers: Record<string, string>; body?: string } {
	const cleanUrl = baseUrl.replace(/\/+$/, '');
	switch (providerType) {
		case 'gemini':
			return {
				url: `${cleanUrl}/v1beta/models/${model || 'gemini-2.5-flash'}:generateContent`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
			};
		case 'anthropic':
			return {
				url: `${cleanUrl}/v1/messages`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
				body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
			};
		default:
			return {
				url: `${cleanUrl}/models`,
				method: 'GET',
				headers: {},
			};
	}
}

/** Perform a health check request for a key against its provider */
async function checkKey(
	apiKey: string,
	providerType: string,
	baseUrl: string,
	model: string
): Promise<boolean> {
	try {
		const req = buildHealthCheckRequest(providerType, baseUrl, model);

		if (providerType === 'gemini') {
			const resp = await fetch(`${req.url}?key=${apiKey}`, {
				method: req.method,
				headers: req.headers,
				body: req.body,
			});
			return resp.ok;
		}

		if (providerType === 'anthropic') {
			const resp = await fetch(req.url, {
				method: req.method,
				headers: { ...req.headers, 'x-api-key': apiKey },
				body: req.body,
			});
			return resp.status !== 401;
		}

		// OpenAI-compat: GET /models with Bearer token
		const resp = await fetch(req.url, {
			method: req.method,
			headers: { ...req.headers, Authorization: `Bearer ${apiKey}` },
		});
		return resp.ok;
	} catch (e) {
		console.error(`Health check error for ${maskKey(apiKey)}:`, e);
		return false;
	}
}

export async function runHealthCheck(sql: DurableObjectStorage['sql']) {
	// Build a map of api_key → { providerType, baseUrl, model } for keys that have health_check_enabled
	const keyProviderRows = await sql.exec(`
		SELECT k.api_key, p.type, p.base_url, k.model
		FROM api_keys k
		JOIN providers p ON p.id = k.provider_id
		WHERE k.health_check_enabled = 1 AND k.enabled = 1
	`).raw<any>();

	const keyProviderMap = new Map<string, { type: string; baseUrl: string; model: string }>();
	for (const row of Array.from(keyProviderRows)) {
		keyProviderMap.set(row[0] as string, { type: row[1] as string, baseUrl: row[2] as string, model: row[3] as string });
	}

	// 1. Handle abnormal keys
	const abnormalKeys = await sql
		.exec("SELECT api_key, failed_count FROM api_keys WHERE key_group = 'abnormal'")
		.raw<any>();

	for (const row of Array.from(abnormalKeys)) {
		const apiKey = row[0] as string;
		const failedCount = row[1] as number;
		const provider = keyProviderMap.get(apiKey);

		if (!provider) continue;

		const ok = await checkKey(apiKey, provider.type, provider.baseUrl, provider.model);
		if (ok) {
			await sql.exec(
				"UPDATE api_keys SET key_group = 'normal', failed_count = 0, last_checked_at = ? WHERE api_key = ?",
				Date.now(), apiKey
			);
		} else {
			await sql.exec(
				'UPDATE api_keys SET failed_count = ?, last_checked_at = ? WHERE api_key = ?',
				failedCount + 1, Date.now(), apiKey
			);
		}
	}

	// 2. Handle stale normal keys
	const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
	const normalKeys = await sql
		.exec(
			"SELECT api_key FROM api_keys WHERE key_group = 'normal' AND (last_checked_at IS NULL OR last_checked_at < ?)",
			twelveHoursAgo
		)
		.raw<any>();

	for (const row of Array.from(normalKeys)) {
		const apiKey = row[0] as string;
		const provider = keyProviderMap.get(apiKey);

		if (!provider) continue;

		const ok = await checkKey(apiKey, provider.type, provider.baseUrl, provider.model);
		if (ok) {
			await sql.exec('UPDATE api_keys SET last_checked_at = ? WHERE api_key = ?', Date.now(), apiKey);
		} else {
			await sql.exec(
				"UPDATE api_keys SET key_group = 'abnormal', failed_count = 1, last_checked_at = ? WHERE api_key = ?",
				Date.now(), apiKey
			);
		}
	}
}

export async function markKeyAbnormal(sql: DurableObjectStorage['sql'], apiKey: string) {
	await sql.exec(
		"UPDATE api_keys SET key_group = 'abnormal', failed_count = failed_count + 1, last_checked_at = ? WHERE api_key = ?",
		Date.now(), apiKey
	);
}
