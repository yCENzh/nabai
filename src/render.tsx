import { jsx } from 'hono/jsx';

const escapeHtml = (str: string) =>
	str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const Render = ({ isAuthenticated, showWarning }: { isAuthenticated: boolean; showWarning: boolean }) => {
	if (!isAuthenticated) {
		return (
			<html>
				<head>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<title>登录</title>
					<style dangerouslySetInnerHTML={{ __html: `
						* { margin: 0; padding: 0; box-sizing: border-box; }
						body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9f9f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
						.login-box { width: 100%; max-width: 320px; padding: 0 16px; }
						.login-box form { background: #fff; border: 1px solid #e5e5e5; padding: 24px; }
						.login-box label { display: block; font-size: 13px; font-weight: 500; color: #333; margin-bottom: 6px; }
						.login-box input { width: 100%; padding: 8px 10px; border: 1px solid #d4d4d4; font-size: 14px; outline: none; }
						.login-box input:focus { border-color: #3b82f6; }
						.login-box button { margin-top: 16px; width: 100%; padding: 9px; background: #1a1a1a; color: #fff; border: none; font-size: 14px; cursor: pointer; }
						.login-box button:hover { background: #333; }
					`}} />
				</head>
				<body>
					<div class="login-box">
						<form id="login-form">
							<label for="auth-key">ACCESS_KEY</label>
							<input id="auth-key" type="password" placeholder="············" />
							<button type="submit">登录</button>
						</form>
					</div>
					<script dangerouslySetInnerHTML={{ __html: `
						document.getElementById('login-form').addEventListener('submit', async function(e) {
							e.preventDefault();
							const key = document.getElementById('auth-key').value;
							const response = await fetch(window.location.href, {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ key }),
							});
							if (response.ok) window.location.reload();
							else alert('登录失败');
						});
					`}}></script>
				</body>
			</html>
		);
	}

	return (
		<html>
			<head>
				<meta charset="UTF-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>Nabai</title>
				<style dangerouslySetInnerHTML={{ __html: `
					* { margin: 0; padding: 0; box-sizing: border-box; }
					body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #fff; font-size: 14px; line-height: 1.5; }

					/* ── Top Nav ── */
					.topnav { border-bottom: 1px solid #e5e5e5; padding: 0 24px; display: flex; align-items: center; gap: 0; background: #fff; position: sticky; top: 0; z-index: 10; }
					.topnav-title { font-size: 15px; font-weight: 600; margin-right: 32px; white-space: nowrap; color: #1a1a1a; }
					.topnav a { display: inline-block; padding: 12px 14px; font-size: 13px; color: #666; text-decoration: none; border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; }
					.topnav a:hover { color: #1a1a1a; }
					.topnav a.active { color: #1a1a1a; border-bottom-color: #1a1a1a; font-weight: 500; }

					/* ── Container ── */
					.container { max-width: 960px; margin: 0 auto; padding: 24px; }
					@media (max-width: 640px) {
						.container { padding: 16px; }
						.topnav { padding: 0 12px; overflow-x: auto; }
						.topnav-title { margin-right: 16px; }
						.topnav a { padding: 10px 10px; font-size: 12px; white-space: nowrap; }
					}

					/* ── Section ── */
					.section { margin-bottom: 32px; }
					.section-title { font-size: 15px; font-weight: 600; margin-bottom: 16px; color: #1a1a1a; }
					.section-subtitle { font-size: 13px; font-weight: 500; margin-bottom: 12px; color: #444; }

					/* ── Form ── */
					.form-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
					.form-field { flex: 1; min-width: 200px; }
					.form-field label { display: block; font-size: 12px; color: #666; margin-bottom: 4px; font-weight: 500; }
					input[type="text"], input[type="password"], select, textarea {
						width: 100%; padding: 7px 10px; border: 1px solid #d4d4d4; font-size: 13px;
						outline: none; background: #fff; transition: border-color .15s;
					}
					input:focus, select:focus, textarea:focus { border-color: #3b82f6; }
					textarea { resize: vertical; font-family: inherit; }

					.form-actions { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
					.checkbox-label { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #444; cursor: pointer; }
					.checkbox-label input { margin: 0; }

					/* ── Buttons ── */
					.btn { display: inline-flex; align-items: center; gap: 4px; padding: 7px 14px; font-size: 13px; border: 1px solid #d4d4d4; background: #fff; color: #1a1a1a; cursor: pointer; transition: all .15s; white-space: nowrap; }
					.btn:hover { background: #f5f5f5; }
					.btn-primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
					.btn-primary:hover { background: #333; }
					.btn-danger { color: #dc2626; border-color: #fca5a5; }
					.btn-danger:hover { background: #fef2f2; }
					.btn-sm { padding: 4px 10px; font-size: 12px; }
					@media (max-width: 640px) {
						.btn-full-mobile { width: 100%; justify-content: center; }
					}

					/* ── Table ── */
					.table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
					table { width: 100%; border-collapse: collapse; font-size: 13px; }
					th { text-align: left; padding: 8px 10px; font-weight: 600; font-size: 12px; color: #666; border-bottom: 2px solid #e5e5e5; white-space: nowrap; }
					td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
					tr:hover td { background: #fafafa; }
					.mono { font-family: 'SF Mono', SFMono-Regular, ui-monospace, monospace; font-size: 12px; word-break: break-all; }
					.text-muted { color: #999; font-size: 12px; }
					.status-ok { color: #16a34a; }
					.status-err { color: #dc2626; }
					.empty-row td { text-align: center; color: #999; padding: 24px 10px; }

					/* hide columns on mobile */
					@media (max-width: 640px) {
						.hide-mobile { display: none; }
					}

					/* ── Toast ── */
					.toast-container { position: fixed; top: 16px; right: 16px; z-index: 100; display: flex; flex-direction: column; gap: 8px; }
					.toast { padding: 10px 16px; font-size: 13px; color: #fff; background: #1a1a1a; animation: toast-in .2s ease-out; max-width: 320px; }
					.toast-error { background: #dc2626; }
					@keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

					/* ── Misc ── */
					.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
					.toolbar-title { font-size: 15px; font-weight: 600; flex: 1; }
					.pagination { display: flex; align-items: center; gap: 8px; font-size: 13px; }
					.pagination span { color: #666; }
					.hidden { display: none !important; }
					.eye-btn { background: none; border: none; cursor: pointer; padding: 2px; color: #999; font-size: 14px; vertical-align: middle; margin-left: 4px; }
					.eye-btn:hover { color: #333; }
					.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 200; align-items: center; justify-content: center; }
					.modal-overlay.open { display: flex; }
					.modal { background: #fff; padding: 24px; max-width: 400px; width: 90%; }
					.modal-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
					.modal-body { font-size: 13px; color: #444; margin-bottom: 16px; }
					.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
					.tag-input { display: flex; flex-wrap: wrap; gap: 4px; padding: 5px 8px; border: 1px solid #d4d4d4; background: #fff; min-height: 34px; align-items: center; cursor: text; }
					.tag-input:focus-within { border-color: #3b82f6; }
					.tag { display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px; background: #f0f0f0; border-radius: 3px; font-size: 12px; }
					.tag-input .tag-remove { cursor: pointer; color: #999; font-size: 14px; line-height: 1; }
					.tag-input .tag-remove:hover { color: #dc2626; }
					.tag-input input { border: none; outline: none; font-size: 13px; flex: 1; min-width: 80px; padding: 2px 0; }
					.dropdown { position: relative; }
					.dropdown-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 4px; background: #fff; border: 1px solid #e5e5e5; min-width: 120px; z-index: 20; }
					.dropdown-menu.open { display: block; }
					.dropdown-item { display: block; width: 100%; padding: 8px 12px; font-size: 13px; border: none; background: none; cursor: pointer; text-align: left; color: #1a1a1a; }
					.dropdown-item:hover { background: #f5f5f5; }
				`}} />
			</head>
			<body>
				{showWarning && (
					<script dangerouslySetInnerHTML={{ __html: `document.addEventListener('DOMContentLoaded',()=>{toast('安全警告：HOME_ACCESS_KEY 或 AUTH_KEY 为默认值，请尽快修改！',true)})` }}></script>
				)}
				<div class="topnav">
					<div class="topnav-title">纳百川</div>
					<nav id="topnav-links">
						<a href="#" data-page="providers" class="active">Provider</a>
						<a href="#" data-page="keys">密钥</a>
						<a href="#" data-page="models">模型</a>
						<a href="#" data-page="endpoints">端点</a>
					</nav>
					<div style="margin-left:auto;display:flex;gap:4px;">
						<button class="btn btn-sm" id="export-btn">导出备份</button>
						<label class="btn btn-sm" style="cursor:pointer;margin:0;"><input type="file" id="import-file" accept=".json" style="display:none" />导入恢复</label>
					</div>
				</div>
				<div class="toast-container" id="toast-container"></div>
				<div class="modal-overlay" id="confirm-modal">
					<div class="modal">
						<div class="modal-title" id="confirm-title"></div>
						<div class="modal-body" id="confirm-body"></div>
						<div class="modal-actions" id="confirm-actions"></div>
					</div>
				</div>
				<div class="container">

					{/* Providers Page */}
					<div id="page-providers" class="page">
						<div class="section">
							<div class="section-title">添加 / 编辑 Provider</div>
							<form id="provider-form">
								<div class="form-row">
									<div class="form-field">
										<label>ID</label>
										<input type="text" id="pf-id" placeholder="openai-main" required />
									</div>
									<div class="form-field">
										<label>类型</label>
										<select id="pf-type">
											<option value="openai_compat">OpenAI 兼容</option>
											<option value="gemini">Gemini (原生)</option>
											<option value="anthropic">Anthropic</option>
										</select>
									</div>
								</div>
								<div class="form-row">
									<div class="form-field">
										<label>名称</label>
										<input type="text" id="pf-name" placeholder="纳百川" required />
									</div>
									<div class="form-field">
										<label>Base URL</label>
										<input type="text" id="pf-base-url" placeholder="https://api.openai.com/v1" required />
									</div>
								</div>
								<div class="form-actions">
									<label class="checkbox-label"><input type="checkbox" id="pf-enabled" checked /> 启用</label>
									<label class="checkbox-label"><input type="checkbox" id="pf-forward" /> 透传客户端密钥</label>
									<button type="submit" class="btn btn-primary" id="provider-submit-btn">保存</button>
									<button type="button" class="btn hidden" id="cancel-provider-btn">取消</button>
								</div>
							</form>
						</div>
						<div class="section">
							<div class="toolbar">
								<div class="toolbar-title">已配置的 Provider</div>
								<button id="refresh-providers" class="btn btn-sm">刷新</button>
							</div>
							<div class="table-wrap">
								<table id="providers-table">
									<thead>
										<tr>
											<th>ID</th>
											<th>类型</th>
											<th>名称</th>
											<th class="hide-mobile">Base URL</th>
											<th>状态</th>
											<th>操作</th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
							</div>
						</div>
					</div>

					{/* Keys Page */}
					<div id="page-keys" class="page hidden">
						<div class="section">
							<div class="section-title">添加密钥</div>
							<form id="add-keys-form">
								<div class="form-field" style="margin-bottom:12px;">
									<label>关联 Provider（必选，可多选）</label>
									<div id="ak-providers-list" style="max-height:150px;overflow-y:auto;border:1px solid #d4d4d4;padding:8px;background:#fff;"></div>
								</div>
								<textarea id="api-keys" style="height: 80px" placeholder="请输入API密钥，每行一个"></textarea>
								<div class="form-actions">
									<label class="checkbox-label"><input type="checkbox" id="ak-health-check" checked /> 启用健康检查</label>
									<button type="submit" class="btn btn-primary" id="key-submit-btn">添加密钥</button>
									<button type="button" class="btn hidden" id="cancel-edit-btn">取消</button>
								</div>
							</form>
						</div>
						<div class="section">
							<div class="toolbar">
								<div class="toolbar-title">密钥列表</div>
								<button id="check-keys-btn" class="btn btn-sm">一键检查</button>
								<button id="refresh-keys-btn" class="btn btn-sm">刷新</button>
							</div>
							<div class="table-wrap">
								<table id="keys-table">
									<thead>
										<tr>
											<th><input type="checkbox" id="select-all-keys" /></th>
											<th>API 密钥</th>
											<th>Provider</th>
											<th>状态</th>
											<th>启用</th>
											<th>健康检查</th>
											<th>操作</th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
							</div>
							<div class="toolbar" style="margin-top: 12px;">
								<div class="pagination">
									<button id="prev-page-btn" class="btn btn-sm" disabled>上一页</button>
									<span id="page-info"></span>
									<button id="next-page-btn" class="btn btn-sm" disabled>下一页</button>
								</div>
								<div style="display:flex;gap:4px;align-items:center;">
									<button id="check-selected-keys-btn" class="btn btn-sm hidden">检查选中</button>
									<button id="delete-selected-keys-btn" class="btn btn-sm btn-danger hidden">删除选中</button>
									<div class="dropdown hidden" id="more-actions-dropdown">
										<button class="btn btn-sm" id="more-actions-btn">···</button>
										<div class="dropdown-menu" id="more-actions-menu">
											<button class="dropdown-item" id="enable-selected-btn">启用所选</button>
											<button class="dropdown-item" id="disable-selected-btn">禁用所选</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>

					{/* Models Page */}
					<div id="page-models" class="page hidden">
						<div class="section">
							<div class="section-title">添加模型</div>
							<form id="model-form">
								<div class="form-row">
									<div class="form-field">
										<label>Model 名称</label>
										<input type="text" id="mf-model" placeholder="如 claude-3-5-sonnet, gpt-4o" required />
									</div>
								</div>
								<div class="form-field" style="margin-bottom:12px;">
									<label>绑定密钥（必选，可多选）</label>
									<div id="mf-keys-list" style="max-height:150px;overflow-y:auto;border:1px solid #d4d4d4;padding:8px;background:#fff;"></div>
								</div>
								<div class="form-actions">
									<button type="submit" class="btn btn-primary" id="model-submit-btn">保存</button>
									<button type="button" class="btn hidden" id="cancel-model-btn">取消</button>
								</div>
							</form>
						</div>
						<div class="section">
							<div class="toolbar">
								<div class="toolbar-title">已配置的模型</div>
								<button id="refresh-models" class="btn btn-sm">刷新</button>
							</div>
							<div class="table-wrap">
								<table id="models-table">
									<thead>
										<tr>
											<th>Model</th>
											<th>绑定的密钥</th>
											<th>操作</th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
							</div>
						</div>
					</div>

					{/* Endpoints Page */}
					<div id="page-endpoints" class="page hidden">
						<div class="section">
							<div class="section-title">添加 / 编辑端点</div>
								<form id="endpoint-form">
								<div class="form-row">
									<div class="form-field">
										<label>ID</label>
										<input type="text" id="ef-id" placeholder="main" required />
									</div>
									<div class="form-field">
										<label>路径</label>
										<input type="text" id="ef-path" placeholder="必须以 / 开头，如 /v1" required />
									</div>
								</div>
								<div class="form-field" style="margin-bottom:12px;">
									<label>绑定 Model（必选，可多选）</label>
									<div id="ef-models-list" style="max-height:150px;overflow-y:auto;border:1px solid #d4d4d4;padding:8px;background:#fff;"></div>
								</div>
								<div class="form-actions">
									<label class="checkbox-label"><input type="checkbox" id="ef-enabled" checked /> 启用</label>
									<button type="submit" class="btn btn-primary" id="endpoint-submit-btn">保存</button>
									<button type="button" class="btn hidden" id="cancel-endpoint-btn">取消</button>
								</div>
							</form>
						</div>
						<div class="section">
							<div class="toolbar">
								<div class="toolbar-title">已配置的端点</div>
								<button id="refresh-endpoints" class="btn btn-sm">刷新</button>
							</div>
							<div class="table-wrap">
								<table id="endpoints-table">
									<thead>
										<tr>
											<th>ID</th>
											<th>路径</th>
											<th>绑定 Model</th>
											<th>状态</th>
											<th>操作</th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
							</div>
						</div>
					</div>

				</div>
				<script dangerouslySetInnerHTML={{ __html: buildClientScript() }}></script>
			</body>
		</html>
	);
};

function buildClientScript(): string {
	return `
const E = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function toast(msg, isError) {
	const c = document.getElementById('toast-container');
	const el = document.createElement('div');
	el.className = 'toast' + (isError ? ' toast-error' : '');
	el.textContent = msg;
	c.appendChild(el);
	setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {

function confirmModal(title, body, buttons) {
	return new Promise(resolve => {
		document.getElementById('confirm-title').textContent = title;
		document.getElementById('confirm-body').textContent = body;
		const actions = document.getElementById('confirm-actions');
		actions.innerHTML = '';
		buttons.forEach(b => {
			const btn = document.createElement('button');
			btn.className = 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : '');
			btn.textContent = b.label;
			btn.addEventListener('click', () => { document.getElementById('confirm-modal').classList.remove('open'); resolve(b.value); });
			actions.appendChild(btn);
		});
		document.getElementById('confirm-modal').classList.add('open');
	});
}

	// ─── Navigation ───
	const navLinks = document.querySelectorAll('#topnav-links a');
	const pages = document.querySelectorAll('.page');
	navLinks.forEach(link => {
		link.addEventListener('click', (e) => {
			e.preventDefault();
			const pageId = 'page-' + link.dataset.page;
			pages.forEach(p => p.classList.toggle('hidden', p.id !== pageId));
			navLinks.forEach(l => l.classList.toggle('active', l === link));
			if (link.dataset.page === 'providers') loadProviders();
			if (link.dataset.page === 'keys') loadKeys();
			if (link.dataset.page === 'models') loadModels();
			if (link.dataset.page === 'endpoints') loadEndpoints();
		});
	});

	// ─── Providers ───
	const providerForm = document.getElementById('provider-form');
	const providersTableBody = document.querySelector('#providers-table tbody');

	async function loadProviders() {
		try {
			const resp = await fetch('/api/providers');
			const { providers } = await resp.json();
			providersTableBody.innerHTML = '';

			const provList = document.getElementById('ak-providers-list');
			if (provList) {
				const currentChecked = Array.from(provList.querySelectorAll('.ak-prov-cb:checked')).map(cb => cb.value);
				provList.innerHTML = '';
				providers.forEach(p => {
					const label = document.createElement('label');
					label.className = 'checkbox-label';
					const checked = currentChecked.includes(p.id) ? 'checked' : '';
					label.innerHTML = '<input type="checkbox" class="ak-prov-cb" value="' + E(p.id) + '" ' + checked + '/> ' + E(p.name) + ' <span class="text-muted">(' + E(p.type) + ')</span>';
					provList.appendChild(label);
				});
			}

			if (providers.length === 0) {
				providersTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">暂无 Provider</td></tr>';
				return;
			}
			providers.forEach(p => {
				const tr = document.createElement('tr');
				tr.innerHTML =
					'<td class="mono">' + E(p.id) + '</td>' +
					'<td>' + E(p.type) + '</td>' +
					'<td>' + E(p.name) + '</td>' +
					'<td class="mono hide-mobile">' + E(p.base_url) + '</td>' +
					'<td>' + (p.enabled ? '<span class="status-ok">启用</span>' : '<span class="status-err">禁用</span>') + '</td>' +
					'<td>' +
						'<button class="btn btn-sm edit-provider" data-id="' + E(p.id) + '" data-type="' + E(p.type) + '" data-name="' + E(p.name) + '" data-url="' + E(p.base_url) + '" data-enabled="' + (p.enabled ? '1' : '0') + '" data-config="' + E(p.config_json || '{}') + '">编辑</button> ' +
						'<button class="btn btn-sm btn-danger del-provider" data-id="' + E(p.id) + '">删除</button>' +
					'</td>';
				providersTableBody.appendChild(tr);
			});
		} catch (e) { console.error('loadProviders:', e); }
	}

	providerForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		const config = { forward_client_key: document.getElementById('pf-forward').checked };
		const data = {
			id: document.getElementById('pf-id').value.trim(),
			type: document.getElementById('pf-type').value,
			name: document.getElementById('pf-name').value.trim(),
			base_url: document.getElementById('pf-base-url').value.trim(),
			enabled: document.getElementById('pf-enabled').checked,
			config_json: JSON.stringify(config),
		};
		if (!data.id || !data.name || !data.base_url) { toast('请填写所有必填项', true); return; }
		try {
			const resp = await fetch('/api/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
			const result = await resp.json();
			if (resp.ok) { toast(result.message); cancelProviderEdit(); loadProviders(); }
			else toast('保存失败: ' + (result.error || ''), true);
		} catch (err) { toast('请求失败', true); }
	});

	let editingProvider = false;
	function cancelProviderEdit() {
		editingProvider = false;
		providerForm.reset();
		document.getElementById('pf-enabled').checked = true;
		document.getElementById('provider-submit-btn').textContent = '保存';
		document.getElementById('cancel-provider-btn').classList.add('hidden');
		document.getElementById('pf-id').disabled = false;
	}
	document.getElementById('cancel-provider-btn').addEventListener('click', cancelProviderEdit);

	providersTableBody.addEventListener('click', async (e) => {
		const btn = e.target.closest('button');
		if (!btn) return;
		if (btn.classList.contains('del-provider')) {
			const action = await confirmModal(
				'删除 Provider',
				'确定删除此 Provider？仅关联此 Provider 的密钥将一并删除，关联了多个 Provider 的密钥不受影响。',
				[
					{ label: '取消', value: 'cancel' },
					{ label: '导出密钥后删除', value: 'export', primary: true },
					{ label: '直接删除', value: 'delete', danger: true },
				]
			);
			if (action === 'cancel') return;
			if (action === 'export') {
				const keysResp = await fetch('/api/keys?page=1&pageSize=9999');
				const { keys } = await keysResp.json();
				const providerKeys = keys.filter(k => (k.provider_ids || []).includes(btn.dataset.id) && k.provider_ids.length === 1);
				if (providerKeys.length > 0) {
					const exportText = providerKeys.map(k => k.api_key).join('\n');
					await navigator.clipboard.writeText(exportText);
					const blob = new Blob([exportText], { type: 'text/plain' });
					const a = document.createElement('a');
					a.href = URL.createObjectURL(blob);
					a.download = 'nabai-keys-' + btn.dataset.id + '.txt';
					a.click();
					URL.revokeObjectURL(a.href);
					toast('已导出 ' + providerKeys.length + ' 个密钥到剪贴板和文件');
				}
			}
			const resp = await fetch('/api/providers', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.id }) });
			const result = await resp.json();
			if (resp.ok) { toast(result.message); loadProviders(); loadKeys(); }
			else toast('删除失败: ' + (result.error || ''), true);
		}
		if (btn.classList.contains('edit-provider')) {
			editingProvider = true;
			document.getElementById('pf-id').value = btn.dataset.id;
			document.getElementById('pf-id').disabled = true;
			document.getElementById('pf-type').value = btn.dataset.type;
			document.getElementById('pf-name').value = btn.dataset.name;
			document.getElementById('pf-base-url').value = btn.dataset.url;
			document.getElementById('pf-enabled').checked = btn.dataset.enabled === '1';
			document.getElementById('provider-submit-btn').textContent = '更新';
			document.getElementById('cancel-provider-btn').classList.remove('hidden');
			try { const cfg = JSON.parse(btn.dataset.config || '{}'); document.getElementById('pf-forward').checked = cfg.forward_client_key === true; } catch { document.getElementById('pf-forward').checked = false; }
		}
	});

	document.getElementById('refresh-providers').addEventListener('click', loadProviders);

	// ─── Keys ───
	const keysTableBody = document.querySelector('#keys-table tbody');
	let currentPage = 1;
	const pageSize = 50;
	let totalPages = 1;

	async function loadKeys() {
		keysTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">加载中...</td></tr>';
		try {
			const resp = await fetch('/api/keys?page=' + currentPage + '&pageSize=' + pageSize);
			const { keys, total } = await resp.json();
			totalPages = Math.ceil(total / pageSize);
			keysTableBody.innerHTML = '';
			if (keys.length === 0) {
				keysTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">暂无密钥</td></tr>';
			} else {
				keys.forEach(k => {
					const tr = document.createElement('tr');
					const safeKey = E(k.api_key);
					const maskedKey = safeKey.length > 12 ? safeKey.slice(0, 6) + '···' + safeKey.slice(-4) : safeKey;
					tr.innerHTML =
						'<td><input type="checkbox" class="key-cb" data-key="' + safeKey + '" data-hce="' + (k.health_check_enabled ? '1' : '0') + '" /></td>' +
						'<td class="mono"><span class="key-display" data-full="' + safeKey + '" data-masked="' + maskedKey + '">' + maskedKey + '</span><button class="eye-btn" title="显示/隐藏">👁</button></td>' +
						'<td>' + (k.provider_names || []).map(n => '<span class="tag">' + E(n) + '</span>').join(' ') + '</td>' +
						'<td>' + (k.key_group === 'normal' ? '<span class="status-ok">正常</span>' : '<span class="status-err">' + E(k.key_group) + '</span>') + '</td>' +
						'<td>' + (k.enabled ? '<span class="status-ok">是</span>' : '<span class="status-err">否</span>') + '</td>' +
						'<td class="text-muted">' + (k.health_check_enabled ? '是' : '否') + '</td>' +
						'<td><button class="btn btn-sm edit-key" data-key="' + safeKey + '" data-providers="' + E((k.provider_ids || []).join(',')) + '" data-hce="' + (k.health_check_enabled ? '1' : '0') + '">编辑</button></td>';
					keysTableBody.appendChild(tr);
				});
			}
			document.getElementById('page-info').textContent = currentPage + ' / ' + totalPages;
			document.getElementById('prev-page-btn').disabled = currentPage <= 1;
			document.getElementById('next-page-btn').disabled = currentPage >= totalPages;
			updateDelBtn();
		} catch (e) { console.error('loadKeys:', e); }
	}

	function updateDelBtn() {
		const checked = document.querySelectorAll('.key-cb:checked');
		const hasSelection = checked.length > 0;
		document.getElementById('delete-selected-keys-btn').classList.toggle('hidden', !hasSelection);
		document.getElementById('check-selected-keys-btn').classList.toggle('hidden', !hasSelection);
		document.getElementById('more-actions-dropdown').classList.toggle('hidden', !hasSelection);
	}

	keysTableBody.addEventListener('change', (e) => { if (e.target.classList.contains('key-cb')) updateDelBtn(); });
	document.getElementById('select-all-keys').addEventListener('change', (e) => {
		document.querySelectorAll('.key-cb').forEach(cb => cb.checked = e.target.checked);
		updateDelBtn();
	});
	document.getElementById('delete-selected-keys-btn').addEventListener('click', async () => {
		const keys = Array.from(document.querySelectorAll('.key-cb:checked')).map(cb => cb.dataset.key);
		if (!keys.length || !confirm('确定删除 ' + keys.length + ' 个密钥？')) return;
		await fetch('/api/keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) });
		loadKeys();
	});
	document.getElementById('check-keys-btn').addEventListener('click', async () => {
		const cbs = document.querySelectorAll('.key-cb[data-hce="1"]');
		const keysToCheck = Array.from(cbs).map(cb => cb.dataset.key);
		if (!keysToCheck.length) { toast('没有启用健康检查的密钥', true); return; }
		cbs.forEach(cb => { const tr = cb.closest('tr'); const sc = tr?.querySelector('.status-err, .status-ok'); if (sc) { sc.className = ''; sc.textContent = '检查中...'; } });
		await fetch('/api/keys/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: keysToCheck }) });
		loadKeys();
	});
	document.getElementById('check-selected-keys-btn').addEventListener('click', async () => {
		const cbs = document.querySelectorAll('.key-cb:checked');
		const keysToCheck = Array.from(cbs).map(cb => cb.dataset.key);
		if (!keysToCheck.length) return;
		cbs.forEach(cb => { const tr = cb.closest('tr'); const sc = tr?.querySelector('.status-err, .status-ok'); if (sc) { sc.className = ''; sc.textContent = '检查中...'; } });
		await fetch('/api/keys/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: keysToCheck }) });
		loadKeys();
	});

	document.getElementById('more-actions-btn').addEventListener('click', (e) => {
		e.stopPropagation();
		document.getElementById('more-actions-menu').classList.toggle('open');
	});
	document.addEventListener('click', () => document.getElementById('more-actions-menu').classList.remove('open'));

	async function toggleSelectedKeys(enabled) {
		const keys = Array.from(document.querySelectorAll('.key-cb:checked')).map(cb => cb.dataset.key);
		if (!keys.length) return;
		const resp = await fetch('/api/keys', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys, enabled }) });
		const result = await resp.json();
		if (resp.ok) { toast(result.message); loadKeys(); }
		else toast('操作失败: ' + (result.error || ''), true);
		document.getElementById('more-actions-menu').classList.remove('open');
	}
	document.getElementById('enable-selected-btn').addEventListener('click', () => toggleSelectedKeys(true));
	document.getElementById('disable-selected-btn').addEventListener('click', () => toggleSelectedKeys(false));

	let editingKey = null;
	const submitBtn = document.getElementById('key-submit-btn');
	const cancelBtn = document.getElementById('cancel-edit-btn');

	document.getElementById('add-keys-form').addEventListener('submit', async (e) => {
		e.preventDefault();
		const provider_ids = Array.from(document.querySelectorAll('.ak-prov-cb:checked')).map(cb => cb.value);
		const health_check_enabled = document.getElementById('ak-health-check').checked;

		if (editingKey) {
			const resp = await fetch('/api/keys', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: editingKey, provider_ids, health_check_enabled }) });
			const result = await resp.json();
			if (resp.ok) { toast(result.message); cancelEdit(); loadKeys(); }
			else toast('更新失败: ' + (result.error || ''), true);
		} else {
			const keys = document.getElementById('api-keys').value.split('\\n').map(k => k.trim()).filter(Boolean);
			if (!keys.length) { toast('请输入至少一个密钥', true); return; }
			const resp = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys, provider_ids, health_check_enabled }) });
			const result = await resp.json();
			if (resp.ok) { toast(result.message); document.getElementById('api-keys').value = ''; loadKeys(); }
			else toast('添加失败: ' + (result.error || ''), true);
		}
	});

	function startEdit(key, providerIds, hce) {
		editingKey = key;
		document.querySelectorAll('.ak-prov-cb').forEach(cb => { cb.checked = providerIds.includes(cb.value); });
		document.getElementById('ak-health-check').checked = hce === '1';
		document.getElementById('api-keys').disabled = true;
		document.getElementById('api-keys').placeholder = '编辑模式：修改属性后点击保存';
		submitBtn.textContent = '保存修改';
		cancelBtn.classList.remove('hidden');
	}

	function cancelEdit() {
		editingKey = null;
		document.getElementById('api-keys').disabled = false;
		document.getElementById('api-keys').placeholder = '请输入API密钥，每行一个';
		submitBtn.textContent = '添加密钥';
		cancelBtn.classList.add('hidden');
	}

	cancelBtn.addEventListener('click', cancelEdit);

	keysTableBody.addEventListener('click', (e) => {
		const btn = e.target.closest('.edit-key');
		if (btn) {
			const providerIds = btn.dataset.providers ? btn.dataset.providers.split(',') : [];
			startEdit(btn.dataset.key, providerIds, btn.dataset.hce);
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	});
	keysTableBody.addEventListener('click', (e) => {
		if (e.target.classList.contains('eye-btn')) {
			const span = e.target.previousElementSibling;
			const shown = span.dataset.shown === '1';
			span.textContent = shown ? span.dataset.masked : span.dataset.full;
			span.dataset.shown = shown ? '0' : '1';
		}
	});
	document.getElementById('refresh-keys-btn').addEventListener('click', loadKeys);
	document.getElementById('prev-page-btn').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadKeys(); } });
	document.getElementById('next-page-btn').addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; loadKeys(); } });

	// ─── Endpoints ───
	const endpointForm = document.getElementById('endpoint-form');
	const endpointsTableBody = document.querySelector('#endpoints-table tbody');

	async function loadEndpoints() {
		try {
			const resp = await fetch('/api/endpoints');
			const { endpoints } = await resp.json();
			endpointsTableBody.innerHTML = '';

			const defaultTr = document.createElement('tr');
			defaultTr.innerHTML =
				'<td class="mono">default</td>' +
				'<td>/v1</td>' +
				'<td class="text-muted">轮询池</td>' +
				'<td><span class="status-ok">启用</span></td>' +
				'<td class="text-muted">系统内置</td>';
			endpointsTableBody.appendChild(defaultTr);

			if (endpoints.length === 0) return;
			endpoints.forEach(ep => {
				const tr = document.createElement('tr');
			tr.innerHTML =
					'<td class="mono">' + E(ep.id) + '</td>' +
					'<td class="mono">/e/' + E(ep.id) + '</td>' +
					'<td>' + (ep.models || []).map(m => '<span class="tag">' + E(m) + '</span>').join(' ') + '</td>' +
					'<td>' + (ep.enabled ? '<span class="status-ok">启用</span>' : '<span class="status-err">禁用</span>') + '</td>' +
					'<td>' +
						'<button class="btn btn-sm edit-endpoint" data-id="' + E(ep.id) + '" data-path="' + E(ep.path) + '" data-models="' + E((ep.models || []).join(',')) + '" data-enabled="' + (ep.enabled ? '1' : '0') + '">编辑</button> ' +
						'<button class="btn btn-sm btn-danger del-endpoint" data-id="' + E(ep.id) + '">删除</button>' +
					'</td>';
				endpointsTableBody.appendChild(tr);
			});
		} catch (e) { console.error('loadEndpoints:', e); }
	}

	endpointForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		let path = document.getElementById('ef-path').value.trim();
		if (path && !path.startsWith('/')) path = '/' + path;
		const models = Array.from(document.querySelectorAll('.ef-model-cb:checked')).map(cb => cb.value);
		const data = {
			id: document.getElementById('ef-id').value.trim(),
			path,
			models,
			enabled: document.getElementById('ef-enabled').checked,
		};
		if (!data.id || !data.path) { toast('请填写所有必填项', true); return; }
		if (!models.length) { toast('请至少绑定一个模型', true); return; }
		const resp = await fetch('/api/endpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
		const result = await resp.json();
		if (resp.ok) { toast(result.message); cancelEndpointEdit(); loadEndpoints(); }
		else toast('保存失败: ' + (result.error || ''), true);
	});

	let editingEndpoint = false;
	function cancelEndpointEdit() {
		editingEndpoint = false;
		endpointForm.reset();
		document.getElementById('ef-enabled').checked = true;
		document.getElementById('endpoint-submit-btn').textContent = '保存';
		document.getElementById('cancel-endpoint-btn').classList.add('hidden');
		document.getElementById('ef-id').disabled = false;
		document.querySelectorAll('.ef-model-cb').forEach(cb => cb.checked = false);
	}
	document.getElementById('cancel-endpoint-btn').addEventListener('click', cancelEndpointEdit);

	endpointsTableBody.addEventListener('click', async (e) => {
		const btn = e.target.closest('button');
		if (!btn) return;
		if (btn.classList.contains('del-endpoint')) {
			if (!confirm('确定删除此端点？')) return;
			await fetch('/api/endpoints', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.id }) });
			loadEndpoints();
		}
		if (btn.classList.contains('edit-endpoint')) {
			editingEndpoint = true;
			document.getElementById('ef-id').value = btn.dataset.id;
			document.getElementById('ef-id').disabled = true;
			document.getElementById('ef-path').value = btn.dataset.path;
			document.getElementById('ef-enabled').checked = btn.dataset.enabled === '1';
			document.getElementById('endpoint-submit-btn').textContent = '更新';
			document.getElementById('cancel-endpoint-btn').classList.remove('hidden');
			const modelList = btn.dataset.models ? btn.dataset.models.split(',') : [];
			loadEndpointModelsList(modelList);
		}
	});

	document.getElementById('refresh-endpoints').addEventListener('click', loadEndpoints);

	async function loadEndpointModelsList(selectedModels) {
		const container = document.getElementById('ef-models-list');
		try {
			const resp = await fetch('/api/models');
			const { models } = await resp.json();
			container.innerHTML = '';
			if (!models.length) { container.innerHTML = '<div class="text-muted">暂无模型，请先添加模型</div>'; return; }
			models.forEach(m => {
				const label = document.createElement('label');
				label.className = 'checkbox-label';
				const checked = selectedModels && selectedModels.includes(m.model) ? 'checked' : '';
				label.innerHTML = '<input type="checkbox" class="ef-model-cb" value="' + E(m.model) + '" ' + checked + '/> ' + E(m.model);
				container.appendChild(label);
			});
		} catch (e) { container.innerHTML = '<div class="text-muted">加载失败</div>'; }
	}
	loadEndpointModelsList(null);

	// ─── Models ───
	const modelForm = document.getElementById('model-form');
	const modelsTableBody = document.querySelector('#models-table tbody');
	let editingModel = null;

	async function loadModels() {
		try {
			const resp = await fetch('/api/models');
			const { models } = await resp.json();
			modelsTableBody.innerHTML = '';
			if (models.length === 0) {
				modelsTableBody.innerHTML = '<tr class="empty-row"><td colspan="3">暂无模型</td></tr>';
				return;
			}
			models.forEach(m => {
				const tr = document.createElement('tr');
				tr.innerHTML =
					'<td class="mono">' + E(m.model) + '</td>' +
					'<td>' + (m.keys.length ? m.keys.map(k => '<span class="tag">' + E(k.length > 12 ? k.slice(0, 6) + '···' + k.slice(-4) : k) + '</span>').join(' ') : '<span class="text-muted">无</span>') + '</td>' +
					'<td>' +
						'<button class="btn btn-sm edit-model" data-model="' + E(m.model) + '" data-keys="' + E(m.keys.join(',')) + '">编辑</button> ' +
						'<button class="btn btn-sm btn-danger del-model" data-model="' + E(m.model) + '">删除</button>' +
					'</td>';
				modelsTableBody.appendChild(tr);
			});
		} catch (e) { console.error('loadModels:', e); }
	}

	async function loadModelKeysList(selectedKeys) {
		const container = document.getElementById('mf-keys-list');
		try {
			const resp = await fetch('/api/keys?page=1&pageSize=9999');
			const { keys } = await resp.json();
			container.innerHTML = '';
			if (!keys.length) { container.innerHTML = '<div class="text-muted">暂无密钥，请先添加密钥</div>'; return; }
			keys.forEach(k => {
				const label = document.createElement('label');
				label.className = 'checkbox-label';
				const masked = k.api_key.length > 12 ? k.api_key.slice(0, 6) + '···' + k.api_key.slice(-4) : k.api_key;
				const checked = selectedKeys && selectedKeys.includes(k.api_key) ? 'checked' : '';
				label.innerHTML = '<input type="checkbox" class="model-key-cb" value="' + E(k.api_key) + '" ' + checked + '/> ' + E(masked) + ' <span class="text-muted">(' + E(k.provider_id) + ')</span>';
				container.appendChild(label);
			});
		} catch (e) { container.innerHTML = '<div class="text-muted">加载失败</div>'; }
	}

	modelForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		const model = document.getElementById('mf-model').value.trim();
		const keys = Array.from(document.querySelectorAll('.model-key-cb:checked')).map(cb => cb.value);
		if (!model) { toast('请输入模型名称', true); return; }
		if (!keys.length) { toast('请至少选择一个密钥', true); return; }
		try {
			const resp = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keys }) });
			const result = await resp.json();
			if (resp.ok) { toast(result.message); modelForm.reset(); editingModel = null; loadModels(); }
			else toast('保存失败: ' + (result.error || ''), true);
		} catch (err) { toast('请求失败', true); }
	});

	modelsTableBody.addEventListener('click', async (e) => {
		const btn = e.target.closest('button');
		if (!btn) return;
		if (btn.classList.contains('del-model')) {
			if (!confirm('确定删除模型 "' + btn.dataset.model + '"？')) return;
			await fetch('/api/models', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: btn.dataset.model }) });
			loadModels();
		}
		if (btn.classList.contains('edit-model')) {
			editingModel = btn.dataset.model;
			document.getElementById('mf-model').value = btn.dataset.model;
			const keys = btn.dataset.keys ? btn.dataset.keys.split(',') : [];
			await loadModelKeysList(keys);
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	});

	document.getElementById('refresh-models').addEventListener('click', loadModels);
	loadModelKeysList(null);

	// ─── Backup / Restore ───
	document.getElementById('export-btn').addEventListener('click', async () => {
		try {
			const resp = await fetch('/api/backup');
			if (!resp.ok) { toast('导出失败', true); return; }
			const data = await resp.json();
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = 'nabai-backup-' + new Date().toISOString().slice(0, 10) + '.json';
			a.click();
			URL.revokeObjectURL(a.href);
			toast('导出成功');
		} catch (e) { toast('导出失败', true); }
	});

	document.getElementById('import-file').addEventListener('change', async (e) => {
		const file = e.target.files[0];
		if (!file) return;
		if (!confirm('导入将覆盖当前所有数据，确定继续？')) { e.target.value = ''; return; }
		try {
			const text = await file.text();
			const data = JSON.parse(text);
			const resp = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
			const result = await resp.json();
			if (resp.ok) { toast('导入成功：' + result.providers + ' 个 Provider，' + result.keys + ' 个密钥，' + (result.models || 0) + ' 个模型，' + result.endpoints + ' 个端点'); loadProviders(); loadKeys(); loadModels(); loadEndpoints(); }
			else toast('导入失败: ' + (result.error || ''), true);
		} catch (err) { toast('文件解析失败', true); }
		e.target.value = '';
	});

	// Initial load
	loadProviders();
});
`;
}
