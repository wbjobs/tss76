const AirflowAdapter = require('./AirflowAdapter');
const JenkinsAdapter = require('./JenkinsAdapter');
const RpcAdapter = require('./RpcAdapter');

const adapterRegistry = {
  airflow: AirflowAdapter,
  jenkins: JenkinsAdapter,
  rpc: RpcAdapter
};

function createAdapter(type, config) {
  const AdapterClass = adapterRegistry[type.toLowerCase()];
  if (!AdapterClass) {
    throw new Error(`Unknown data source type: ${type}`);
  }
  return new AdapterClass(config);
}

function getAvailableTypes() {
  return [
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
        { name: 'token', label: 'Token', type: 'password', dependsOn: { authType: 'bearer' } }
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
        { name: 'token', label: 'Token', type: 'password', dependsOn: { authType: 'bearer' } }
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
        { name: 'apiKeyHeader', label: 'API Key Header', type: 'text', placeholder: 'X-API-Key', dependsOn: { authType: 'apikey' } }
      ]
    }
  ];
}

module.exports = {
  createAdapter,
  getAvailableTypes,
  adapterRegistry
};
