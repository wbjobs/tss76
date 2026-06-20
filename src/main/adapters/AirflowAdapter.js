const BaseAdapter = require('./BaseAdapter');

class AirflowAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async test() {
    try {
      await this.fetch(`${this.baseUrl}/api/v1/dags?limit=1`);
      return { success: true, message: '连接成功' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async fetchTasks() {
    const tasks = [];
    try {
      const dagsData = await this.fetch(`${this.baseUrl}/api/v1/dags?limit=100`);
      const dags = (dagsData && dagsData.dags) || [];

      for (const dag of dags) {
        if (dag.is_paused) continue;

        try {
          const runsData = await this.fetch(
            `${this.baseUrl}/api/v1/dags/${dag.dag_id}/dagRuns?limit=20&order_by=-start_date`
          );
          const runs = (runsData && runsData.dag_runs) || [];

          for (const run of runs) {
            tasks.push(this.normalizeTask(dag, run));
          }
        } catch (e) {
          console.error(`Failed to fetch runs for DAG ${dag.dag_id}:`, e.message);
        }
      }
    } catch (e) {
      console.error('Airflow fetch error:', e.message);
    }
    return tasks;
  }

  normalizeTask(dag, run) {
    const stateMap = {
      'success': 'success',
      'failed': 'failed',
      'running': 'running',
      'queued': 'running',
      'running': 'running',
      'up_for_retry': 'running',
      'up_for_reschedule': 'running',
      'deferred': 'pending',
      'scheduled': 'pending',
      'none': 'pending'
    };

    const state = stateMap[run.state] || 'unknown';
    let progress = 0;

    if (state === 'success') progress = 100;
    else if (state === 'failed') progress = 100;
    else if (state === 'running') progress = 50;

    return {
      id: `airflow-${dag.dag_id}-${run.dag_run_id}`,
      sourceType: 'airflow',
      name: `${dag.dag_id} - ${run.dag_run_id}`,
      dagName: dag.dag_id,
      runId: run.dag_run_id,
      state,
      progress,
      startTime: run.start_date || null,
      endTime: run.end_date || null,
      externalUrl: `${this.baseUrl}/dags/${dag.dag_id}/grid?dag_run_id=${encodeURIComponent(run.dag_run_id)}`,
      raw: { dag, run }
    };
  }
}

module.exports = AirflowAdapter;
