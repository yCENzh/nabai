import { maskKey } from '../core/utils';

export async function healthCheckKey(
	apiKey: string,
	providerType: string,
	baseUrl: string,
	model: string,
	providerName?: string
): Promise<boolean> {
	const cleanUrl = baseUrl.replace(/\/+$/, '');
	try {
		let resp: Response;
		let url: string;
		let reqBody: string;
		let reqHeaders: Record<string, string>;
		if (providerType === 'gemini') {
			const m = model.startsWith('models/') ? model.substring(7) : model;
			url = `${cleanUrl}/v1beta/models/${m}:generateContent?key=${apiKey}`;
			reqBody = JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] });
			reqHeaders = { 'Content-Type': 'application/json' };
			resp = await fetch(url, {
				method: 'POST',
				headers: reqHeaders,
				body: reqBody,
				signal: AbortSignal.timeout(15_000),
			});
		} else if (providerType === 'anthropic') {
			url = `${cleanUrl}/v1/messages`;
			reqBody = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
			reqHeaders = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
			resp = await fetch(url, {
				method: 'POST',
				headers: reqHeaders,
				body: reqBody,
				signal: AbortSignal.timeout(15_000),
			});
		} else {
			url = `${cleanUrl}/chat/completions`;
			reqBody = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
			reqHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
			resp = await fetch(url, {
				method: 'POST',
				headers: reqHeaders,
				body: reqBody,
				signal: AbortSignal.timeout(15_000),
			});
		}

		if (!resp.ok) {
			const resBody = await resp.text().catch(() => '');
			console.log(`[health] FAIL provider=${providerName || ''}(${providerType})
POST ${url}
headers=${JSON.stringify(reqHeaders)}
> ${reqBody}
< HTTP ${resp.status}
${resBody.slice(0, 500)}`);
		}
		return resp.ok;
	} catch (e) {
		console.error(`Health check error for ${maskKey(apiKey)}:`, e);
		return false;
	}
}

export function getAbnormalKeyConfigs(sql: DurableObjectStorage['sql']): Array<{ apiKey: string; providerType: string; providerName: string; baseUrl: string; model: string }> {
	return Array.from(sql.exec(`
		SELECT k.api_key, p.type, p.name, p.base_url, m.model
		FROM api_keys k
		JOIN key_providers kp ON kp.api_key = k.api_key
		JOIN providers p ON p.id = kp.provider_id
		JOIN key_models m ON m.api_key = k.api_key
		WHERE k.key_group = 'abnormal' AND k.health_check_enabled = 1 AND k.enabled = 1 AND p.enabled = 1
	`).raw<[string, string, string, string, string]>()).map(row => ({
		apiKey: row[0] as string,
		providerType: row[1] as string,
		providerName: row[2] as string,
		baseUrl: row[3] as string,
		model: row[4] as string,
	}));
}

