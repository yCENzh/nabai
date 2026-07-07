export class ConfigManager {
	constructor(private sql: DurableObjectStorage['sql']) {}

	initSchema() {
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS providers (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				name TEXT NOT NULL,
				base_url TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				config_json TEXT NOT NULL DEFAULT '{}',
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);

			CREATE TABLE IF NOT EXISTS api_keys (
				id TEXT PRIMARY KEY,
				api_key TEXT NOT NULL UNIQUE,
				enabled INTEGER NOT NULL DEFAULT 1,
				health_check_enabled INTEGER NOT NULL DEFAULT 1,
				key_group TEXT NOT NULL DEFAULT 'normal',
				created_at INTEGER NOT NULL DEFAULT (unixepoch())
			);

			CREATE TABLE IF NOT EXISTS key_providers (
				id TEXT PRIMARY KEY,
				api_key TEXT NOT NULL,
				provider_id TEXT NOT NULL,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				UNIQUE(api_key, provider_id)
			);

			CREATE TABLE IF NOT EXISTS key_models (
				id TEXT PRIMARY KEY,
				model TEXT NOT NULL,
				api_key TEXT NOT NULL,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				UNIQUE(model, api_key)
			);

			CREATE TABLE IF NOT EXISTS endpoint_models (
				id TEXT PRIMARY KEY,
				endpoint_id TEXT NOT NULL,
				model TEXT NOT NULL,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				UNIQUE(endpoint_id, model)
			);

			CREATE TABLE IF NOT EXISTS endpoints (
				id TEXT PRIMARY KEY,
				enabled INTEGER NOT NULL DEFAULT 1,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);
		`);

		this.sql.exec("INSERT OR IGNORE INTO endpoints (id, enabled) VALUES ('default', 1)");
	}
}
