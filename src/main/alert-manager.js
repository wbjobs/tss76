const { Notification } = require('electron');
const path = require('path');

class AlertManager {
  constructor(db, app) {
    this.db = db;
    this.app = app;
    this.taskStateHistory = new Map();
    this.failureCounts = new Map();
  }

  evaluateRules(aggregatedData) {
    const rules = this.db.getAlertRules().filter(r => r.enabled);
    if (rules.length === 0) return;

    const tasks = aggregatedData.tasks || [];
    const triggered = [];

    for (const rule of rules) {
      const matchedTasks = [];

      for (const task of tasks) {
        if (this.matchCondition(rule.condition, task)) {
          matchedTasks.push(task);
        }
      }

      if (matchedTasks.length > 0) {
        if (this.checkFailureThreshold(rule, matchedTasks) && !this.isInCooldown(rule)) {
          for (const task of matchedTasks) {
            this.triggerAlert(rule, task);
            triggered.push({ rule, task });
          }
          this.db.markRuleTriggered(rule.id);
        }
      }

      this.updateStateHistory(tasks);
    }

    if (triggered.length > 0) {
      this.app.broadcast('alerts-triggered', {
        count: triggered.length,
        timestamp: new Date().toISOString()
      });
    }
  }

  matchCondition(condition, task) {
    if (!condition || Object.keys(condition).length === 0) return false;

    if (condition.state && task.state !== condition.state) {
      return false;
    }

    if (condition.states && Array.isArray(condition.states)) {
      if (!condition.states.includes(task.state)) return false;
    }

    if (condition.sourceType && task.sourceType !== condition.sourceType) {
      return false;
    }

    if (condition.sourceId !== undefined && condition.sourceId !== null && condition.sourceId !== '') {
      if (String(task.sourceId) !== String(condition.sourceId)) return false;
    }

    if (condition.taskNamePattern && condition.taskNamePattern.trim()) {
      const pattern = condition.taskNamePattern.trim();
      try {
        const regex = new RegExp(pattern, 'i');
        if (!regex.test(task.name || '')) return false;
      } catch (e) {
        if (!String(task.name || '').toLowerCase().includes(pattern.toLowerCase())) return false;
      }
    }

    if (condition.minProgress !== undefined && condition.minProgress !== null && condition.minProgress !== '') {
      if ((task.progress || 0) < Number(condition.minProgress)) return false;
    }

    if (condition.longRunningMs) {
      if (task.state === 'running' && task.startTime) {
        const elapsed = Date.now() - new Date(task.startTime).getTime();
        if (elapsed < Number(condition.longRunningMs)) return false;
      } else {
        return false;
      }
    }

    return true;
  }

  checkFailureThreshold(rule, matchedTasks) {
    const threshold = rule.condition && rule.condition.failureThreshold
      ? Number(rule.condition.failureThreshold)
      : 1;

    if (threshold <= 1) return true;

    const trackMode = rule.condition.trackMode || 'perTask';

    if (trackMode === 'perTask') {
      let hit = false;
      for (const task of matchedTasks) {
        if (task.state === 'failed' || task.state === 'warning') {
          const key = task.id;
          const count = (this.failureCounts.get(key) || 0) + 1;
          this.failureCounts.set(key, count);
          if (count >= threshold) {
            this.failureCounts.set(key, 0);
            hit = true;
          }
        }
      }
      return hit;
    }

    if (trackMode === 'totalAcrossTasks') {
      return matchedTasks.length >= threshold;
    }

    return matchedTasks.length > 0;
  }

  updateStateHistory(tasks) {
    const currentIds = new Set();
    for (const task of tasks) {
      currentIds.add(task.id);
      const prev = this.taskStateHistory.get(task.id);
      this.taskStateHistory.set(task.id, {
        state: task.state,
        updatedAt: new Date().toISOString()
      });

      if (prev && prev.state !== 'failed' && (task.state === 'success' || task.state === 'running')) {
        this.failureCounts.delete(task.id);
      }
    }

    for (const key of Array.from(this.taskStateHistory.keys())) {
      if (!currentIds.has(key)) {
        this.taskStateHistory.delete(key);
      }
    }
  }

  isInCooldown(rule) {
    if (!rule.lastTriggeredAt) return false;
    const cooldown = (rule.cooldownSeconds || 300) * 1000;
    const last = new Date(rule.lastTriggeredAt).getTime();
    return (Date.now() - last) < cooldown;
  }

  triggerAlert(rule, task) {
    const title = `[告警] ${rule.name}`;
    const body = this.buildNotificationBody(rule, task);

    this.sendNativeNotification(title, body, task);

    this.db.addAlertEvent({
      ruleId: rule.id,
      ruleName: rule.name,
      eventType: 'notification',
      taskId: task.id,
      taskName: task.name,
      sourceName: task.sourceName,
      message: body,
      payload: {
        ruleCondition: rule.condition,
        task
      }
    });
  }

  buildNotificationBody(rule, task) {
    const lines = [];
    lines.push(`任务: ${task.name}`);
    lines.push(`数据源: ${task.sourceName || task.sourceType}`);
    lines.push(`状态: ${this.stateLabel(task.state)}`);
    if (typeof task.progress === 'number') {
      lines.push(`进度: ${task.progress}%`);
    }
    if (task.startTime) {
      lines.push(`开始: ${new Date(task.startTime).toLocaleString('zh-CN')}`);
    }
    return lines.join('\n');
  }

  stateLabel(state) {
    const map = {
      running: '运行中',
      success: '成功',
      failed: '失败',
      pending: '等待中',
      warning: '警告',
      unknown: '未知'
    };
    return map[state] || state;
  }

  sendNativeNotification(title, body, task) {
    try {
      if (!Notification.isSupported()) {
        console.warn('系统不支持原生通知');
        return;
      }

      const notif = new Notification({
        title,
        body,
        silent: false,
        urgency: 'normal'
      });

      if (task && task.externalUrl) {
        notif.on('click', () => {
          const { shell } = require('electron');
          shell.openExternal(task.externalUrl);
        });
      }

      notif.show();
    } catch (e) {
      console.error('Failed to send notification:', e.message);
    }
  }

  testNotification(ruleData) {
    try {
      const title = `[测试告警] ${ruleData.name || '未命名规则'}`;
      const sampleTask = {
        id: 'test-123',
        name: '示例任务 sample-daily-job',
        sourceName: ruleData.condition?.sourceId ? '所选数据源' : '生产 Airflow',
        sourceType: 'airflow',
        state: ruleData.condition?.state || 'failed',
        progress: 72,
        startTime: new Date(Date.now() - 1800000).toISOString()
      };
      const body = this.buildNotificationBody(ruleData, sampleTask);
      this.sendNativeNotification(title, body, sampleTask);
      return { success: true };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
}

module.exports = AlertManager;
