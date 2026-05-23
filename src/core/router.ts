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
