const BaseAdapter = require('./BaseAdapter');

class JenkinsAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async test() {
    try {
      await this.fetch(`${this.baseUrl}/api/json?tree=jobs[name]`);
      return { success: true, message: '连接成功' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async fetchTasks() {
    const tasks = [];
    try {
      const jobsData = await this.fetch(`${this.baseUrl}/api/json?tree=jobs[name,url,builds[number,result,building,timestamp,duration,estimatedDuration]]`);
      const jobs = jobsData.jobs || [];

      for (const job of jobs) {
        const builds = job.builds || [];
        const recentBuilds = builds.slice(0, 10);

        for (const build of recentBuilds) {
          tasks.push(this.normalizeTask(job, build));
        }
      }
    } catch (e) {
      console.error('Jenkins fetch error:', e.message);
    }
    return tasks;
  }

  normalizeTask(job, build) {
    let state;
    if (build.building) {
      state = 'running';
    } else {
      switch (build.result) {
        case 'SUCCESS':
          state = 'success';
          break;
        case 'FAILURE':
        case 'ABORTED':
          state = 'failed';
          break;
        case 'UNSTABLE':
          state = 'warning';
          break;
        default:
          state = 'unknown';
      }
    }

    let progress = 0;
    if (state === 'success' || state === 'failed' || state === 'warning') {
      progress = 100;
    } else if (build.building && build.estimatedDuration > 0) {
      const elapsed = Date.now() - build.timestamp;
      progress = Math.min(95, Math.round((elapsed / build.estimatedDuration) * 100));
    }

    return {
      id: `jenkins-${job.name}-${build.number}`,
      sourceType: 'jenkins',
      name: `${job.name} #${build.number}`,
      jobName: job.name,
      buildNumber: build.number,
      state,
      progress,
      startTime: build.timestamp ? new Date(build.timestamp).toISOString() : null,
      endTime: build.duration && build.timestamp ? new Date(build.timestamp + build.duration).toISOString() : null,
      duration: build.duration || 0,
      externalUrl: `${job.url}${build.number}/`,
      raw: { job, build }
    };
  }
}

module.exports = JenkinsAdapter;
