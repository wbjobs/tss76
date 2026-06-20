class DashboardRenderer {
  constructor() {
    this.currentData = null;
    this.dataSources = [];
    this.availableTypes = [
      {
        type: 'airflow',
        label: 'Apache Airflow',
        description: '通过 Airflow REST API v2 拉取 DAG 运行状态',
        fields: [
          { name: 'baseUrl', label: 'API Base URL', type: 'text', placeholder: 'http://localhost:8080', required: true },
          { name: 'authType', label: '认证方式', type: 'select', options: [
            { value: 'none', label: '无认证' },
            { value: 'basic', label: 'Basic Auth' },
            { value: 'bearer', label: 'Bearer Token' }
          ]},
          { name: 'username', label: '用户名', type: 'text', dependsOn: { authType: 'basic' } },
          { name: 'password', label: '密码', type: 'password', dependsOn: { authType: 'basic' } },
          { name: 'token', label: 'Token', type: 'password', dependsOn: { authType: 'bearer' } },
          { name: 'timeout', label: '超时时间 (ms)', type: 'number', placeholder: '15000' }
        ]
      },
      {
        type: 'jenkins',
        label: 'Jenkins',
        description: '通过 Jenkins REST API 拉取 Job/Build 状态',
        fields: [
          { name: 'baseUrl', label: 'Jenkins URL', type: 'text', placeholder: 'http://localhost:8080', required: true },
          { name: 'authType', label: '认证方式', type: 'select', options: [
            { value: 'none', label: '无认证' },
            { value: 'basic', label: '用户名/密码 (或API Token)' },
            { value: 'bearer', label: 'Bearer Token' }
          ]},
          { name: 'username', label: '用户名', type: 'text', dependsOn: { authType: 'basic' } },
          { name: 'password', label: '密码 / API Token', type: 'password', dependsOn: { authType: 'basic' } },
          { name: 'token', label: 'Token', type: 'password', dependsOn: { authType: 'bearer' } },
          { name: 'timeout', label: '超时时间 (ms)', type: 'number', placeholder: '15000' }
        ]
      },
      {
        type: 'rpc',
        label: '自定义 RPC / HTTP',
        description: '对接自定义任务调度系统的 HTTP JSON API',
        fields: [
          { name: 'baseUrl', label: 'API Base URL', type: 'text', placeholder: 'http://localhost:9000', required: true },
          { name: 'listPath', label: '任务列表路径', type: 'text', placeholder: '/tasks' },
          { name: 'detailPath', label: '任务详情路径', type: 'text', placeholder: '/tasks/:id' },
          { name: 'authType', label: '认证方式', type: 'select', options: [
            { value: 'none', label: '无认证' },
            { value: 'basic', label: 'Basic Auth' },
            { value: 'bearer', label: 'Bearer Token' },
            { value: 'apikey', label: 'API Key' }
          ]},
          { name: 'username', label: '用户名', type: 'text', dependsOn: { authType: 'basic' } },
          { name: 'password', label: '密码', type: 'password', dependsOn: { authType: 'basic' } },
          { name: 'token', label: 'Token', type: 'password', dependsOn: { authType: 'bearer' } },
          { name: 'apiKey', label: 'API Key', type: 'password', dependsOn: { authType: 'apikey' } },
          { name: 'apiKeyHeader', label: 'API Key Header', type: 'text', placeholder: 'X-API-Key', dependsOn: { authType: 'apikey' } },
          { name: 'timeout', label: '超时时间 (ms)', type: 'number', placeholder: '15000' }
        ]
      }
    ];
    this.editingSourceId = null;
    this.filterState = 'all';
    this.filterSource = 'all';
    this.searchQuery = '';

    this.init();
  }

  init() {
    this.bindEvents();
    this.loadInitialData();
    this.setupRealTimeUpdates();
    this.populateSourceTypes();
  }

  bindEvents() {
    document.getElementById('refreshBtn').addEventListener('click', () => this.refreshData());
    document.getElementById('configBtn').addEventListener('click', () => this.openConfigModal());
    document.getElementById('closeModal').addEventListener('click', () => this.closeConfigModal());
    document.getElementById('configModal').addEventListener('click', (e) => {
      if (e.target.id === 'configModal') this.closeConfigModal();
    });

    document.getElementById('filterState').addEventListener('change', (e) => {
      this.filterState = e.target.value;
      this.renderTasks();
    });

    document.getElementById('filterSource').addEventListener('change', (e) => {
      this.filterSource = e.target.value;
      this.renderTasks();
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderTasks();
    });

    document.getElementById('addSourceBtn').addEventListener('click', () => this.resetForm());
    document.getElementById('sourceForm').addEventListener('submit', (e) => this.handleFormSubmit(e));
    document.getElementById('sourceType').addEventListener('change', () => this.renderDynamicFields());
    document.getElementById('testConnectionBtn').addEventListener('click', () => this.testConnection());
    document.getElementById('resetFormBtn').addEventListener('click', () => this.resetForm());
  }

  populateSourceTypes() {
    const select = document.getElementById('sourceType');
    for (const t of this.availableTypes) {
      const opt = document.createElement('option');
      opt.value = t.type;
      opt.textContent = t.label;
      select.appendChild(opt);
    }
  }

  async loadInitialData() {
    try {
      this.dataSources = await window.dashboardAPI.getDataSources();
      const data = await window.dashboardAPI.getAggregatedData();
      this.updateData(data);
      this.renderConfigSources();
      this.updateSourceFilter();
    } catch (e) {
      console.error('Failed to load initial data:', e);
    }
  }

  setupRealTimeUpdates() {
    window.dashboardAPI.onDataUpdated((data) => {
      this.updateData(data);
    });
  }

  updateData(data) {
    this.currentData = data;
    this.renderStats();
    this.renderSources();
    this.renderTasks();
    this.updateRefreshStatus();
  }

  updateRefreshStatus() {
    const status = document.getElementById('refreshStatus');
    const time = this.currentData?.timestamp
      ? new Date(this.currentData.timestamp).toLocaleTimeString('zh-CN')
      : '';

    status.className = 'refresh-status up-to-date';
    status.textContent = `已更新 ${time}`;

    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      status.className = 'refresh-status idle';
      status.textContent = time ? `上次更新 ${time}` : '等待刷新';
    }, 3000);
  }

  async refreshData() {
    const status = document.getElementById('refreshStatus');
    status.className = 'refresh-status refreshing';
    status.textContent = '刷新中...';

    try {
      await window.dashboardAPI.refreshNow();
      const data = await window.dashboardAPI.getAggregatedData();
      this.updateData(data);
    } catch (e) {
      console.error('Refresh failed:', e);
      status.className = 'refresh-status idle';
      status.textContent = '刷新失败';
    }
  }

  renderStats() {
    const counts = this.currentData?.counts || {};
    document.getElementById('statTotal').textContent = this.currentData?.total || 0;
    document.getElementById('statRunning').textContent = counts.running || 0;
    document.getElementById('statSuccess').textContent = counts.success || 0;
    document.getElementById('statFailed').textContent = counts.failed || 0;
    document.getElementById('statPending').textContent = counts.pending || 0;
    document.getElementById('statWarning').textContent = counts.warning || 0;
  }

  renderSources() {
    const container = document.getElementById('sourcesList');
    const sources = this.currentData?.sources || [];

    if (sources.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无数据源，请点击右上角"数据源配置"添加</div>';
      return;
    }

    const bySource = this.currentData?.bySource || [];
    const bySourceMap = {};
    for (const s of bySource) bySourceMap[s.sourceId] = s;

    container.innerHTML = sources.map(s => {
      const stats = bySourceMap[s.sourceId]?.counts || { running: 0, success: 0, failed: 0, pending: 0 };
      return `
        <div class="source-card">
          <div class="source-card-header">
            <span class="source-name">${this.escapeHtml(s.sourceName)}</span>
            <span class="source-type">${this.escapeHtml(s.sourceType)}</span>
          </div>
          <div class="source-status">
            <span class="status-indicator ${s.success ? 'ok' : 'error'}"></span>
            <span>${s.success ? `已获取 ${s.taskCount} 个任务` : `连接失败: ${this.escapeHtml(s.error || '未知错误')}`}</span>
          </div>
          ${s.timeout ? `<div class="source-status" style="margin-top:4px;font-size:11px;color:var(--text-muted)">超时: ${s.timeout}ms</div>` : ''}
          <div class="source-stats">
            <div class="source-stat">
              <div class="source-stat-label">运行中</div>
              <div class="source-stat-value" style="color: var(--running)">${stats.running || 0}</div>
            </div>
            <div class="source-stat">
              <div class="source-stat-label">成功</div>
              <div class="source-stat-value" style="color: var(--success)">${stats.success || 0}</div>
            </div>
            <div class="source-stat">
              <div class="source-stat-label">失败</div>
              <div class="source-stat-value" style="color: var(--failed)">${stats.failed || 0}</div>
            </div>
            <div class="source-stat">
              <div class="source-stat-label">等待中</div>
              <div class="source-stat-value" style="color: var(--pending)">${stats.pending || 0}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateSourceFilter() {
    const select = document.getElementById('filterSource');
    const currentVal = select.value;
    select.innerHTML = '<option value="all">全部数据源</option>';
    for (const ds of this.dataSources) {
      const opt = document.createElement('option');
      opt.value = String(ds.id);
      opt.textContent = ds.name;
      select.appendChild(opt);
    }
    select.value = currentVal;
  }

  renderTasks() {
    const container = document.getElementById('tasksList');
    const tasks = this.currentData?.tasks || [];

    const filtered = tasks.filter(t => {
      if (this.filterState !== 'all' && t.state !== this.filterState) return false;
      if (this.filterSource !== 'all' && String(t.sourceId) !== this.filterSource) return false;
      if (this.searchQuery && !t.name.toLowerCase().includes(this.searchQuery)) return false;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无任务数据</div>';
      return;
    }

    const stateLabels = {
      running: '运行中',
      success: '成功',
      failed: '失败',
      pending: '等待中',
      warning: '警告',
      unknown: '未知'
    };

    container.innerHTML = filtered.map(t => {
      const startTime = t.startTime ? new Date(t.startTime).toLocaleString('zh-CN') : '-';
      return `
        <div class="task-card">
          <div class="task-info">
            <div class="task-name" title="${this.escapeHtml(t.name)}">${this.escapeHtml(t.name)}</div>
            <div class="task-meta">
              <span class="task-source-tag">${this.escapeHtml(t.sourceName || t.sourceType)}</span>
              <span class="task-meta-item">开始: ${startTime}</span>
              ${t.externalUrl ? `<a href="#" class="task-meta-item" onclick="window.open('${this.escapeHtml(t.externalUrl)}');return false;">查看详情 &rarr;</a>` : ''}
            </div>
          </div>
          <div class="task-state ${t.state}">
            <span class="task-state-icon"></span>
            ${stateLabels[t.state] || t.state}
          </div>
          <div class="task-progress">
            <div class="progress-label">
              <span>进度</span>
              <span>${t.progress || 0}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill ${t.state}" style="width: ${t.progress || 0}%"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  openConfigModal() {
    document.getElementById('configModal').classList.remove('hidden');
    this.renderConfigSources();
    this.resetForm();
  }

  closeConfigModal() {
    document.getElementById('configModal').classList.add('hidden');
  }

  async renderConfigSources() {
    this.dataSources = await window.dashboardAPI.getDataSources();
    const container = document.getElementById('configSourcesList');

    if (this.dataSources.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding: 30px 10px;">暂无数据源</div>';
      return;
    }

    container.innerHTML = this.dataSources.map(ds => `
      <div class="config-source-item ${this.editingSourceId === ds.id ? 'active' : ''}" data-id="${ds.id}">
        <div class="config-source-name">
          ${this.escapeHtml(ds.name)}
          ${!ds.enabled ? ' <span style="color: var(--text-muted); font-size: 11px;">(已禁用)</span>' : ''}
        </div>
        <div class="config-source-type">${this.getTypeLabel(ds.type)}</div>
        <div class="config-source-actions">
          <button class="btn btn-secondary btn-sm" onclick="dashboard.editSource(${ds.id})">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="dashboard.deleteSource(${ds.id})">删除</button>
        </div>
      </div>
    `).join('');
  }

  getTypeLabel(type) {
    const t = this.availableTypes.find(x => x.type === type);
    return t ? t.label : type;
  }

  editSource(id) {
    const ds = this.dataSources.find(d => d.id === id);
    if (!ds) return;

    this.editingSourceId = id;
    document.getElementById('formTitle').textContent = '编辑数据源';
    document.getElementById('sourceId').value = String(id);
    document.getElementById('sourceName').value = ds.name;
    document.getElementById('sourceType').value = ds.type;
    document.getElementById('sourceEnabled').checked = ds.enabled !== false;

    this.renderDynamicFields(ds.config || {});
    this.renderConfigSources();
  }

  async deleteSource(id) {
    if (!confirm('确定要删除此数据源吗？')) return;
    try {
      await window.dashboardAPI.deleteDataSource(id);
      this.editingSourceId = null;
      await this.renderConfigSources();
      this.resetForm();
      this.updateSourceFilter();
      this.refreshData();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  resetForm() {
    this.editingSourceId = null;
    document.getElementById('formTitle').textContent = '新增数据源';
    document.getElementById('sourceForm').reset();
    document.getElementById('sourceId').value = '';
    document.getElementById('sourceEnabled').checked = true;
    document.getElementById('testResult').textContent = '';
    document.getElementById('testResult').className = 'test-result';
    this.renderDynamicFields();
    this.renderConfigSources();
  }

  renderDynamicFields(existingConfig = {}) {
    const type = document.getElementById('sourceType').value;
    const typeDef = this.availableTypes.find(t => t.type === type);
    const container = document.getElementById('dynamicFields');

    if (!typeDef) {
      container.innerHTML = '';
      return;
    }

    const currentConfig = { ...existingConfig };
    const authType = type === '' ? '' : (existingConfig.authType || document.getElementById('sourceType').value ? 'none' : '');

    container.innerHTML = typeDef.fields.map(field => {
      const shouldShow = !field.dependsOn ||
        Object.keys(field.dependsOn).every(k => currentConfig[k] === field.dependsOn[k]);

      if (!shouldShow) return '';

      const value = existingConfig[field.name] !== undefined ? existingConfig[field.name] : '';

      if (field.type === 'select') {
        return `
          <div class="form-group">
            <label>${field.label}</label>
            <select class="form-input" data-field="${field.name}" ${field.required ? 'required' : ''}>
              ${field.options.map(o => `<option value="${o.value}" ${value === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select>
          </div>
        `;
      }

      return `
        <div class="form-group">
          <label>${field.label}</label>
          <input type="${field.type}" class="form-input" data-field="${field.name}"
            value="${this.escapeHtml(String(value))}"
            placeholder="${field.placeholder || ''}"
            ${field.required ? 'required' : ''}>
        </div>
      `;
    }).join('');

    container.querySelectorAll('select[data-field]').forEach(sel => {
      sel.addEventListener('change', () => {
        const config = this.collectFormConfig();
        this.renderDynamicFields(config);
      });
    });
  }

  collectFormConfig() {
    const config = {};
    document.querySelectorAll('#dynamicFields [data-field]').forEach(el => {
      const name = el.dataset.field;
      if (el.type === 'checkbox') {
        config[name] = el.checked;
      } else if (el.type === 'number') {
        const val = parseInt(el.value, 10);
        config[name] = isNaN(val) ? '' : val;
      } else {
        config[name] = el.value;
      }
    });
    return config;
  }

  collectFormData() {
    return {
      name: document.getElementById('sourceName').value.trim(),
      type: document.getElementById('sourceType').value,
      enabled: document.getElementById('sourceEnabled').checked,
      config: this.collectFormConfig()
    };
  }

  async handleFormSubmit(e) {
    e.preventDefault();
    const data = this.collectFormData();
    const id = document.getElementById('sourceId').value;

    if (!data.name || !data.type) {
      alert('请填写名称和类型');
      return;
    }

    try {
      if (id) {
        await window.dashboardAPI.updateDataSource(parseInt(id), data);
      } else {
        await window.dashboardAPI.addDataSource(data);
      }
      this.resetForm();
      await this.renderConfigSources();
      this.updateSourceFilter();
      this.refreshData();
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  async testConnection() {
    const data = this.collectFormData();
    const resultEl = document.getElementById('testResult');

    if (!data.type || !data.config.baseUrl) {
      resultEl.className = 'test-result error';
      resultEl.textContent = '请先选择类型并填写URL';
      return;
    }

    resultEl.className = 'test-result';
    resultEl.textContent = '测试中...';

    try {
      const result = await window.dashboardAPI.testConnection(data);
      if (result.success) {
        resultEl.className = 'test-result success';
        resultEl.textContent = '✓ ' + result.message;
      } else {
        resultEl.className = 'test-result error';
        resultEl.textContent = '✗ ' + result.message;
      }
    } catch (e) {
      resultEl.className = 'test-result error';
      resultEl.textContent = '✗ ' + e.message;
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

window.dashboard = null;
window.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new DashboardRenderer();
});
