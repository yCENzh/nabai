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
				in_default_rotation INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);

			CREATE TABLE IF NOT EXISTS api_keys (
				id TEXT PRIMARY KEY,
				provider_id TEXT NOT NULL,
				model TEXT NOT NULL DEFAULT '',
				api_key TEXT NOT NULL UNIQUE,
				enabled INTEGER NOT NULL DEFAULT 1,
				health_check_enabled INTEGER NOT NULL DEFAULT 1,
				key_group TEXT NOT NULL DEFAULT 'normal',
				in_default_rotation INTEGER NOT NULL DEFAULT 0,
				last_checked_at INTEGER,
				failed_count INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				FOREIGN KEY(provider_id) REFERENCES providers(id)
			);

			CREATE TABLE IF NOT EXISTS endpoints (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL,
				provider_id TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch())
			);
		`);
	}
}
