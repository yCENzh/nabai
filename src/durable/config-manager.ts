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
				provider_id TEXT NOT NULL,
				label TEXT,
				model TEXT NOT NULL DEFAULT '',
				api_key TEXT NOT NULL,
				enabled INTEGER NOT NULL DEFAULT 1,
				health_check_enabled INTEGER NOT NULL DEFAULT 1,
				priority INTEGER NOT NULL DEFAULT 100,
				weight INTEGER NOT NULL DEFAULT 100,
				created_at INTEGER NOT NULL DEFAULT (unixepoch()),
				updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
				FOREIGN KEY(provider_id) REFERENCES providers(id)
			);

			CREATE TABLE IF NOT EXISTS api_key_statuses (
				api_key TEXT PRIMARY KEY,
				status TEXT CHECK(status IN ('normal', 'abnormal')) NOT NULL DEFAULT 'normal',
				last_checked_at INTEGER,
				failed_count INTEGER NOT NULL DEFAULT 0,
				key_group TEXT CHECK(key_group IN ('normal', 'abnormal')) NOT NULL DEFAULT 'normal'
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
