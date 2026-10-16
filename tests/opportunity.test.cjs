const { test } = require('node:test');
const assert = require('node:assert/strict');
const demand = require('../src/shared/opportunity.js');

const item = { post_id: '2', text: '每天手动做几十条视频太累了，愿意付费找工具', parent_text: '聊视频制作' };
const result = {
  post_id: '2', is_demand: true, cluster_id: '', cluster_name: 'AI 视频批量生产需求',
  demand_type: 'repetitive_work', need: '批量做视频', pain_point: '手动制作耗时', target_users: '视频创作者',
  current_solution: '', solution_evidence: '', need_evidence: '每天手动做几十条视频太累了',
  payment_evidence: '愿意付费', demand_strength: 90, pain_score: 80, payment_score: 80,
  competition_level: 'unknown', competition_evidence: '', directions: ['AI 视频批量生产工具', '代运营服务']
};

test('cheap prefilter only rejects noise, leaving semantic demand decisions to AI', () => {
  assert.equal(demand.scanCandidate('每天手动整理几十份报表，真累'), true);
  assert.equal(demand.scanCandidate('这个方案可能需要更方便的界面'), true);
  assert.equal(demand.scanCandidate('哈哈哈'), false);
  assert.equal(demand.scanCandidate('私信领取免费工具'), false);
});

test('AI demand output requires matching IDs, source quotes and grounded payment or competition claims', () => {
  assert.equal(demand.validateBatch({ results: [result] }, [item])[0].cluster_name, 'AI 视频批量生产需求');
  assert.deepEqual(demand.validateBatch({ results: [{ post_id: '2', is_demand: false }] }, [item]), [{ post_id: '2', is_demand: false }]);
  assert.throws(() => demand.validateBatch({ results: [{ ...result, need_evidence: '我需要 API' }] }, [item]), /证据/);
  assert.throws(() => demand.validateBatch({ results: [{ ...result, payment_evidence: '' }] }, [item]), /付费分数/);
  assert.throws(() => demand.validateBatch({ results: [{ ...result, demand_strength: 101 }] }, [item]), /分数/);
  assert.throws(() => demand.validateBatch({ results: [{ ...result, competition_level: 'high' }] }, [item]), /竞争判断/);
  assert.throws(() => demand.validateBatch({ results: [{ ...result, cluster_id: 'made-up' }] }, [item]), /聚类 ID/);
  assert.throws(() => demand.validateBatch({ results: [result, result] }, [item]), /数量/);
  assert.throws(() => demand.parseAI('not json'), /JSON/);
});

test('cluster aggregation reports unique frequency, payment signals, directions and sample-limited trend', () => {
  const first = { postId: '2', clusterName: result.cluster_name, needEvidence: result.need_evidence, url: 'https://x.com/a/status/2',
    demandStrength: 90, painScore: 80, paymentScore: 80, paymentEvidence: result.payment_evidence,
    painPoint: result.pain_point, targetUsers: result.target_users, currentSolution: '', competitionLevel: 'unknown', competitionEvidence: '', directions: result.directions };
  const second = { ...first, postId: '3', demandStrength: 80, painScore: 60, paymentScore: 0, paymentEvidence: '', needEvidence: '做视频很费时', directions: ['AI 视频批量生产工具'] };
  const rec = demand.summarizeCluster({ id: 'need:1', name: result.cluster_name }, [first, second]);
  assert.equal(rec.demandCount, 2);
  assert.equal(rec.paymentSignalCount, 1);
  assert.equal(rec.demandStrength, 85);
  assert.equal(rec.opportunityScore, 62);
  assert.equal(rec.trend, '样本不足');
  assert.deepEqual(rec.possibleDirections, result.directions);
  assert.equal(rec.inPool, false);
});

test('trend compares only dated scanned samples across two seven-day windows', () => {
  const days = [0, 1, 2, 3, 10, 15].map(n => ({ createdAt: new Date(Date.UTC(2026, 9, 1 + n)).toISOString() }));
  assert.match(demand.trendOf(days), /已扫描样本/);
  assert.equal(demand.trendOf(days.slice(0, 3)), '样本不足');
});
