'use strict';
// Pure metric calculations: engagement rate, follower ratio, account age.

function calculateEngagement(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  const keys = ['likes', 'replies', 'reposts', 'quotes', 'views'];
  if (!keys.every(k => Number.isSafeInteger(metrics[k]) && metrics[k] >= 0)) return null;
  if (metrics.views === 0) return null;
  const total = metrics.likes + metrics.replies + metrics.reposts + metrics.quotes;
  if (!Number.isSafeInteger(total)) return null;
  return total / metrics.views * 100;
}

function getFollowerRatio(user) {
  if (!user || !Number.isSafeInteger(user.followers) || user.followers < 0) return null;
  if (!Number.isSafeInteger(user.following) || user.following <= 0) return null;
  return user.followers / user.following;
}

function getAccountAge(user, now = Date.now()) {
  if (!user || typeof user.createdAt !== 'string' || !user.createdAt) return null;
  const created = new Date(user.createdAt);
  if (!Number.isFinite(+created)) return null;
  if (created.getTime() > now) return null; // future dates are not allowed
  const n = new Date(now);
  let years = n.getFullYear() - created.getFullYear();
  let months = n.getMonth() - created.getMonth();
  if (n.getDate() < created.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  return { years, months, totalMonths: years * 12 + months };
}

module.exports = { calculateEngagement, getFollowerRatio, getAccountAge };
