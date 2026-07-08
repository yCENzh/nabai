import { jsx } from 'hono/jsx';

const escapeHtml = (str: string) =>
	str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HINT_PATH = 'https://YOUR-DOMAIN/e/{id}';

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
						<a href="javascript:void(0)" data-page="providers" class="active">Provider</a>
						<a href="javascript:void(0)" data-page="keys">密钥</a>
						<a href="javascript:void(0)" data-page="models">模型</a>
						<a href="javascript:void(0)" data-page="endpoints">端点</a>
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
										<div class="text-muted" style="font-size:11px;margin-top:2px;" id="pf-base-url-hint"></div>
									</div>
								</div>
								<div class="form-actions">
									<label class="checkbox-label"><input type="checkbox" id="pf-enabled" checked /> 启用</label>
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
										<label>Model 名称（支持批量，用空格/逗号分隔）</label>
										<div class="tag-input" id="mf-model-tags">
											<input type="text" id="mf-model-input" placeholder="输入模型名称，按回车或失焦确认" autocomplete="off" />
										</div>
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
									<div class="text-muted" style="font-size:12px;margin-top:2px;">
										访问路径：<span id="ef-path-display"></span><span id="ef-path-hint">{HINT_PATH}</span>
									</div>
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
											<th>访问路径</th>
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
				<script src="/admin/resources.js"></script>
			</body>
		</html>
	);
};

