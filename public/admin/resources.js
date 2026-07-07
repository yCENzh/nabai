
const E = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function renderTags(items, renderItem, max) {
	if (!items || items.length === 0) return '<span class="text-muted">无</span>';
	if (items.length <= max) return items.map(renderItem).join(' ');
	const visible = items.slice(0, max);
	const hidden = items.slice(max);
	return visible.map(renderItem).join(' ') +
		' <span class="tag tag-more">+' + hidden.length + '</span>' +
		' <span class="tag-extra" style="display:none">' + hidden.map(renderItem).join(' ') +
		' <span class="tag tag-more" data-collapse>收起</span></span>';
}

function toast(msg, isError) {
	const c = document.getElementById('toast-container');
	if (!c) return;
	const el = document.createElement('div');
	el.className = 'toast' + (isError ? ' toast-error' : '');
	el.textContent = msg;
	c.appendChild(el);
	setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {

document.addEventListener('click', (e) => {
	const el = e.target;
	if (!el.classList.contains('tag-more')) return;
	if (el.dataset.collapse !== undefined) {
		const extra = el.closest('.tag-extra');
		if (!extra) return;
		extra.style.display = 'none';
		const prev = extra.previousElementSibling;
		if (prev && prev.classList.contains('tag-more') && prev.dataset.collapse === undefined) {
			prev.style.display = '';
		}
	} else {
		const extra = el.nextElementSibling;
		if (!extra || !extra.classList.contains('tag-extra')) return;
		extra.style.display = '';
		el.style.display = 'none';
	}
});

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
				if (providers.length === 0) {
					provList.innerHTML = '<div class="text-muted">暂无 Provider，请先添加</div>';
				} else {
					providers.forEach(p => {
						const label = document.createElement('label');
						label.className = 'checkbox-label';
						const checked = currentChecked.includes(p.id) ? 'checked' : '';
						label.innerHTML = '<input type="checkbox" class="ak-prov-cb" value="' + E(p.id) + '" ' + checked + '/> ' + E(p.name) + ' <span class="text-muted">(' + E(p.type) + ')</span>';
						provList.appendChild(label);
					});
				}
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
		} catch (e) { console.error('loadProviders:', e); providersTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">加载失败</td></tr>'; }
	}

	providerForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		const data = {
			id: document.getElementById('pf-id').value.trim(),
			type: document.getElementById('pf-type').value,
			name: document.getElementById('pf-name').value.trim(),
			base_url: document.getElementById('pf-base-url').value.trim(),
			enabled: document.getElementById('pf-enabled').checked,
			config_json: '{}',
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
						'<td>' + renderTags(k.provider_names, n => '<span class="tag">' + E(n) + '</span>', 3) + '</td>' +
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
		} catch (e) { console.error('loadKeys:', e); keysTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">加载失败</td></tr>'; }
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
		if (!keys.length) return;
		const ok = await confirmModal('删除密钥', '确定删除 ' + keys.length + ' 个密钥？\n注意：如果这些密钥绑定了模型，模型绑定关系也会被一并删除。', [
			{ label: '取消', value: false },
			{ label: '确定删除', value: true, danger: true },
		]);
		if (!ok) return;
		await fetch('/api/keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }) });
		loadKeys();
	});
	document.getElementById('check-keys-btn').addEventListener('click', async () => {
		const cbs = document.querySelectorAll('.key-cb[data-hce="1"]');
		const keysToCheck = Array.from(cbs).map(cb => cb.dataset.key);
		if (!keysToCheck.length) { toast('没有启用健康检查的密钥', true); return; }
		cbs.forEach(cb => { const tr = cb.closest('tr'); const sc = tr?.querySelector('.status-err, .status-ok'); if (sc) { sc.className = ''; sc.textContent = '检查中...'; } });
		const resp = await fetch('/api/keys/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: keysToCheck }) });
		const results = await resp.json();
		const skipped = results.filter((r) => r.skipped);
		if (skipped.length) toast(skipped.length + ' 个密钥无绑定模型，已跳过检查');
		loadKeys();
	});
	document.getElementById('check-selected-keys-btn').addEventListener('click', async () => {
		const cbs = document.querySelectorAll('.key-cb:checked');
		const keysToCheck = Array.from(cbs).map(cb => cb.dataset.key);
		if (!keysToCheck.length) return;
		cbs.forEach(cb => { const tr = cb.closest('tr'); const sc = tr?.querySelector('.status-err, .status-ok'); if (sc) { sc.className = ''; sc.textContent = '检查中...'; } });
		const resp = await fetch('/api/keys/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: keysToCheck }) });
		const results = await resp.json();
		const skipped = results.filter((r) => r.skipped);
		if (skipped.length) toast(skipped.length + ' 个密钥无绑定模型，已跳过检查');
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
			const keys = document.getElementById('api-keys').value.split('\n').map(k => k.trim()).filter(Boolean);
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
			loadEndpointModelsList(null);
			const resp = await fetch('/api/endpoints');
			const { endpoints } = await resp.json();
			endpointsTableBody.innerHTML = '';

			endpoints.forEach(ep => {
				const tr = document.createElement('tr');
				const modelsHtml = renderTags(ep.models, m => '<span class="tag">' + E(m) + '</span>', 3);
				const pathDisplay = ep.id === 'default' ? '/v1' : '/e/' + E(ep.id);
			tr.innerHTML =
					'<td class="mono">' + E(ep.id) + '</td>' +
					'<td class="mono">' + pathDisplay + '</td>' +
					'<td>' + modelsHtml + '</td>' +
					'<td>' + (ep.enabled ? '<span class="status-ok">启用</span>' : '<span class="status-err">禁用</span>') + '</td>' +
					'<td>' +
						'<button class="btn btn-sm edit-endpoint" data-id="' + E(ep.id) + '" data-models="' + E((ep.models || []).join(',')) + '" data-enabled="' + (ep.enabled ? '1' : '0') + '">编辑</button> ' +
						(ep.id === 'default' ? '' : '<button class="btn btn-sm btn-danger del-endpoint" data-id="' + E(ep.id) + '">删除</button>') +
					'</td>';
				endpointsTableBody.appendChild(tr);
			});
		} catch (e) { console.error('loadEndpoints:', e); endpointsTableBody.innerHTML = '<tr class="empty-row"><td colspan="5">加载失败</td></tr>'; }
	}

	function updatePathPreview(id) {
		const display = document.getElementById('ef-path-display');
		const hint = document.getElementById('ef-path-hint');
		if (id) {
			display.textContent = location.origin + (id === 'default' ? '/v1' : '/e/' + id);
			hint.style.display = 'none';
		} else {
			display.textContent = '';
			hint.style.display = '';
		}
	}
	document.getElementById('ef-id').addEventListener('blur', (e) => updatePathPreview(e.target.value));

	endpointForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		const id = document.getElementById('ef-id').value.trim();
		if (!id) { toast('请填写端点 ID', true); return; }
		const models = Array.from(document.querySelectorAll('.ef-model-cb:checked')).map(cb => cb.value);
		if (!models.length) { toast('请至少绑定一个模型', true); return; }
		const data = { id, models, enabled: document.getElementById('ef-enabled').checked };
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
		updatePathPreview('');
		document.querySelectorAll('.ef-model-cb').forEach(cb => cb.checked = false);
	}
	document.getElementById('cancel-endpoint-btn').addEventListener('click', cancelEndpointEdit);

	endpointsTableBody.addEventListener('click', async (e) => {
		const btn = e.target.closest('button');
		if (!btn) return;
		if (btn.classList.contains('del-endpoint')) {
			const ok = await confirmModal('删除端点', '确定删除此端点？', [
				{ label: '取消', value: false },
				{ label: '确定删除', value: true, danger: true },
			]);
			if (!ok) return;
			await fetch('/api/endpoints', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.id }) });
			loadEndpoints();
		}
		if (btn.classList.contains('edit-endpoint')) {
			editingEndpoint = true;
			document.getElementById('ef-id').value = btn.dataset.id;
			document.getElementById('ef-id').disabled = true;
			updatePathPreview(btn.dataset.id);
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

	// ─── Models ───
	const modelForm = document.getElementById('model-form');
	const modelTagsContainer = document.getElementById('mf-model-tags');
	const modelTagInput = document.getElementById('mf-model-input');
	const modelsTableBody = document.querySelector('#models-table tbody');
	let editingModel = null;
	let modelTags = [];

	function renderModelTags() {
		modelTagsContainer.innerHTML = '';
		modelTags.forEach((tag, i) => {
			const span = document.createElement('span');
			span.className = 'tag';
			span.innerHTML = E(tag) + '<span class="tag-remove" data-index="' + i + '">×</span>';
			modelTagsContainer.appendChild(span);
		});
		modelTagsContainer.appendChild(modelTagInput);
		modelTagInput.focus();
	}

	function addModelTags(raw) {
		const parts = raw.split(/[\s,，、　]+/).map(s => s.trim()).filter(Boolean);
		if (parts.length === 0) return;
		for (const p of parts) {
			if (!modelTags.includes(p)) modelTags.push(p);
		}
		modelTagInput.value = '';
		renderModelTags();
	}

	function removeModelTag(index) {
		modelTags.splice(index, 1);
		renderModelTags();
	}

	modelTagsContainer.addEventListener('click', (e) => {
		if (e.target === modelTagsContainer) modelTagInput.focus();
		const remove = e.target.closest('.tag-remove');
		if (remove && remove.dataset.index !== undefined) {
			removeModelTag(parseInt(remove.dataset.index));
		}
	});

	modelTagInput.addEventListener('blur', () => {
		if (modelTagInput.value.trim()) addModelTags(modelTagInput.value);
	});

	modelTagInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			if (modelTagInput.value.trim()) addModelTags(modelTagInput.value);
		}
	});

	async function loadModels() {
		try {
			loadModelKeysList(null);
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
					'<td>' + renderTags(m.keys, k => '<span class="tag">' + E(k.length > 12 ? k.slice(0, 6) + '···' + k.slice(-4) : k) + '</span>', 3) + '</td>' +
					'<td>' +
						'<button class="btn btn-sm edit-model" data-model="' + E(m.model) + '" data-keys="' + E(m.keys.join(',')) + '">编辑</button> ' +
						'<button class="btn btn-sm btn-danger del-model" data-model="' + E(m.model) + '">删除</button>' +
					'</td>';
				modelsTableBody.appendChild(tr);
			});
		} catch (e) { console.error('loadModels:', e); modelsTableBody.innerHTML = '<tr class="empty-row"><td colspan="3">加载失败</td></tr>'; }
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
				label.innerHTML = '<input type="checkbox" class="model-key-cb" value="' + E(k.api_key) + '" ' + checked + '/> ' + E(masked) + ' <span class="text-muted">' + ((k.provider_names || []).length ? '(' + E(k.provider_names.join(', ')) + ')' : '') + '</span>';
				container.appendChild(label);
			});
		} catch (e) { container.innerHTML = '<div class="text-muted">加载失败</div>'; }
	}

	function cancelModelEdit() {
		editingModel = null;
		modelTags = [];
		modelTagInput.value = '';
		renderModelTags();
		document.getElementById('model-submit-btn').textContent = '保存';
		document.getElementById('cancel-model-btn').classList.add('hidden');
	}

	document.getElementById('cancel-model-btn').addEventListener('click', cancelModelEdit);

	modelForm.addEventListener('submit', async (e) => {
		e.preventDefault();
		if (modelTagInput.value.trim()) addModelTags(modelTagInput.value);
		const keys = Array.from(document.querySelectorAll('.model-key-cb:checked')).map(cb => cb.value);
		if (!modelTags.length) { toast('请输入模型名称', true); return; }
		if (!keys.length) { toast('请至少选择一个密钥', true); return; }
		let added = 0;
		for (const model of modelTags) {
			try {
				const resp = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keys }) });
				const result = await resp.json();
				if (resp.ok) added++;
				else toast('保存失败: ' + model + ' — ' + (result.error || ''), true);
			} catch (err) { toast('请求失败: ' + model, true); }
		}
		if (added > 0) { toast('成功添加 ' + added + ' 个模型'); cancelModelEdit(); loadModels(); }
	});

	modelsTableBody.addEventListener('click', async (e) => {
		const btn = e.target.closest('button');
		if (!btn) return;
		if (btn.classList.contains('del-model')) {
			const ok = await confirmModal('删除模型', '确定删除模型 "' + btn.dataset.model + '"？', [
				{ label: '取消', value: false },
				{ label: '确定删除', value: true, danger: true },
			]);
			if (!ok) return;
			await fetch('/api/models', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: btn.dataset.model }) });
			loadModels();
			loadEndpoints();
		}
		if (btn.classList.contains('edit-model')) {
			editingModel = btn.dataset.model;
			modelTags = [btn.dataset.model];
			modelTagInput.value = '';
			renderModelTags();
			document.getElementById('model-submit-btn').textContent = '更新';
			document.getElementById('cancel-model-btn').classList.remove('hidden');
			const keys = btn.dataset.keys ? btn.dataset.keys.split(',') : [];
			await loadModelKeysList(keys);
			window.scrollTo({ top: 0, behavior: 'smooth' });
		}
	});

	document.getElementById('refresh-models').addEventListener('click', loadModels);

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
		const ok = await confirmModal('导入数据', '导入将覆盖当前所有数据，确定继续？', [
			{ label: '取消', value: false },
			{ label: '确定导入', value: true, danger: true },
		]);
		if (!ok) { e.target.value = ''; return; }
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