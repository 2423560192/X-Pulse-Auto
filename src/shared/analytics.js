'use strict';
// Account detail calculations.

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

module.exports = { getFollowerRatio, getAccountAge };
