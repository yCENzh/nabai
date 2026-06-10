import { maskKey } from '../core/utils';

async function checkKey(
	apiKey: string,
	providerType: string,
	baseUrl: string,
	model: string,
	providerName?: string
): Promise<boolean> {
	try {
		const cleanUrl = baseUrl.replace(/\/+$/, '');

		let resp: Response;
		if (providerType === 'gemini') {
			resp = await fetch(`${cleanUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }),
			});
		} else if (providerType === 'anthropic') {
			resp = await fetch(`${cleanUrl}/v1/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
				body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
			});
		} else {
			resp = await fetch(`${cleanUrl}/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
			});
		}

		if (!resp.ok) {
			console.log(`[health] FAIL key=${maskKey(apiKey)} provider=${providerName || ''}(${providerType}) model=${model} status=${resp.status}`);
		}
		return resp.ok;
	} catch (e) {
		console.error(`Health check error for ${maskKey(apiKey)}:`, e);
		return false;
	}
}

export async function runHealthCheck(sql: DurableObjectStorage['sql']) {
	const rows = Array.from(sql.exec(`
		SELECT k.api_key, p.type, p.name, p.base_url, m.model
		FROM api_keys k
		JOIN key_providers kp ON kp.api_key = k.api_key
		JOIN providers p ON p.id = kp.provider_id
		JOIN key_models m ON m.api_key = k.api_key
		WHERE k.key_group = 'abnormal' AND k.health_check_enabled = 1 AND k.enabled = 1 AND p.enabled = 1
	`).raw<any>());

	for (const row of rows) {
		const apiKey = row[0] as string;
		const providerType = row[1] as string;
		const providerName = row[2] as string;
		const baseUrl = row[3] as string;
		const model = row[4] as string;
		const ok = await checkKey(apiKey, providerType, baseUrl, model, providerName);
		if (ok) {
			console.log(`[health] RECOVERED key=${maskKey(apiKey)} provider=${providerName}(${providerType})`);
			await sql.exec("UPDATE api_keys SET key_group = 'normal' WHERE api_key = ?", apiKey);
		}
	}
}

export async function markKeyAbnormal(sql: DurableObjectStorage['sql'], apiKey: string) {
	console.log(`[health] MARKED ABNORMAL key=${maskKey(apiKey)}`);
	await sql.exec("UPDATE api_keys SET key_group = 'abnormal' WHERE api_key = ?", apiKey);
}
