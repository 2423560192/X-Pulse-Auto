'use strict';

const aiClient = require('../shared/ai-client.js');

function attachAIConnection({ button, status, readInput, requestPermission, rpc, paintAI, clearError, now = () => new Date() }) {
  let busy = false;
  const label = button.textContent;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = '测试中…';
    clearError();
    status.dataset.state = 'pending';
    status.textContent = '正在检查 AI 服务地址…';
    try {
      const input = readInput();
      const origin = aiClient.originPattern(input.baseUrl);
      status.textContent = '正在申请 AI 服务域名权限…';
      // Call permissions.request before the first await to retain the click gesture.
      const permission = requestPermission({ origins: [origin] });
      if (!(await permission)) throw new Error('未授予 AI 服务域名权限');
      status.textContent = '正在保存 AI 设置…';
      paintAI(await rpc('saveAI', { ai: input }));
      status.dataset.state = 'pending';
      status.textContent = '正在连接 AI 服务，请稍候（最长 ' + Math.ceil((input.timeout || 30000) / 1000) + ' 秒）…';
      await rpc('testAI');
      status.dataset.state = 'success';
      status.textContent = '连接测试成功（' + now().toLocaleTimeString('zh-CN', { hour12: false }) + '），可以开始扫描';
    } catch (e) {
      status.dataset.state = 'error';
      status.textContent = '连接测试失败：' + (e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = label;
    }
  });
}

module.exports = attachAIConnection;
