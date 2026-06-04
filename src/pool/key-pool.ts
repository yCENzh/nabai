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

async function checkKey(
	apiKey: string,
	providerType: string,
	baseUrl: string,
	model: string
): Promise<boolean> {
	try {
		const cleanUrl = baseUrl.replace(/\/+$/, '');

		if (providerType === 'gemini') {
			const m = model || 'gemini-2.5-flash';
			const resp = await fetch(`${cleanUrl}/v1beta/models/${m}:generateContent?key=${apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
			});
			return resp.ok;
		}

		if (providerType === 'anthropic') {
			const body = { model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };
			const resp = await fetch(`${cleanUrl}/v1/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
				body: JSON.stringify(body),
			});
			return resp.ok;
		}

		const resp = await fetch(`${cleanUrl}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
		});
		return resp.ok;
	} catch (e) {
		console.error(`Health check error for ${maskKey(apiKey)}:`, e);
		return false;
	}
}

export async function runHealthCheck(sql: DurableObjectStorage['sql']) {
	const rows = Array.from(sql.exec(`
		SELECT k.api_key, p.type, p.base_url, k.model
		FROM api_keys k
		JOIN providers p ON p.id = k.provider_id
		WHERE k.key_group = 'abnormal' AND k.health_check_enabled = 1 AND k.enabled = 1 AND p.enabled = 1
	`).raw<any>());

	for (const row of rows) {
		const apiKey = row[0] as string;
		const ok = await checkKey(apiKey, row[1] as string, row[2] as string, row[3] as string);
		if (ok) {
			await sql.exec("UPDATE api_keys SET key_group = 'normal' WHERE api_key = ?", apiKey);
		}
	}
}

export async function markKeyAbnormal(sql: DurableObjectStorage['sql'], apiKey: string) {
	await sql.exec("UPDATE api_keys SET key_group = 'abnormal' WHERE api_key = ?", apiKey);
}
