#!/usr/bin/env node
'use strict';
// 本机 HTTP 中转：http://127.0.0.1:<端口>/<路径>  ->  <目标源>/<路径>
//
// 用途：AI 服务只提供 HTTP、且由第三方提供时，浏览器扩展只接受
// HTTPS 或本机 HTTP。在 127.0.0.1 上开一个只本机可见的中转，
// 扩展填 http://127.0.0.1:<端口>/... 即可正常保存和调用。
//
// 用法：
//   node tools/http-relay.cjs <目标源> [本机端口]
//   node tools/http-relay.cjs http://api.example.com 18181
//   node tools/http-relay.cjs http://api.example.com:3000 18181
//
// 规则：启动参数只写到“协议 + 主机 + 端口”，不要带路径；
//       扩展里填的路径会原样转发（例如扩展填 http://127.0.0.1:18181/v1，
//       实际请求 http://api.example.com/v1/chat/completions）。
//
// 注意：本工具不会加密最后一跳到目标服务的公网 HTTP 明文流量；
//       它只解决“扩展不接受非本机 HTTP”的问题。仅监听 127.0.0.1，
//       不记录请求头和请求体（不落盘 API Key）。

const http = require('http');
const https = require('https');

const MAX_BODY = 10 * 1024 * 1024; // 10 MB
const TIMEOUT_MS = 120000;

function usage() {
  console.error('用法: node tools/http-relay.cjs <目标源> [本机端口]');
  console.error('  例: node tools/http-relay.cjs http://api.example.com 18181');
  console.error('  目标源只写到协议+主机+端口，不要带路径；扩展里保留原来的路径（如 /v1）。');
}

const [targetArg, portArg] = process.argv.slice(2);
if (!targetArg) { usage(); process.exit(1); }

let target;
try { target = new URL(targetArg); } catch { console.error('目标地址无效: ' + targetArg); process.exit(1); }
if (target.protocol !== 'http:' && target.protocol !== 'https:') {
  console.error('目标地址必须以 http:// 或 https:// 开头');
  process.exit(1);
}
if (target.pathname && target.pathname !== '/' || target.search || target.hash) {
  console.error('目标源不要带路径/参数，路径请保留在扩展里填写的地址中。');
  process.exit(1);
}

const port = portArg === undefined ? 18181 : Number(portArg);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('端口无效: ' + portArg); process.exit(1); }

const transport = target.protocol === 'https:' ? https : http;
const upstreamPort = target.port || (target.protocol === 'https:' ? 443 : 80);

function reply(res, status, message) {
  const body = JSON.stringify({ error: { message } });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  let tooLarge = false;
  req.on('data', chunk => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > MAX_BODY) { tooLarge = true; reply(res, 413, '请求体过大'); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('error', () => { if (!res.headersSent) res.destroy(); });
  req.on('end', () => {
    if (tooLarge) return;
    const body = Buffer.concat(chunks);
    const upstreamPath = req.url || '/';
    const headers = { ...req.headers, host: target.host };
    headers['content-length'] = String(body.length);

    console.log(new Date().toISOString() + '  ' + req.method + ' ' + upstreamPath + '  ->  ' + target.origin + upstreamPath);

    const upstream = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: upstreamPort,
      method: req.method,
      path: upstreamPath,
      headers
    }, upstreamRes => {
      const outHeaders = { ...upstreamRes.headers };
      res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => res.destroy());
    });

    upstream.setTimeout(TIMEOUT_MS, () => upstream.destroy(new Error('上游超时')));
    upstream.on('error', error => {
      if (!res.headersSent) reply(res, 502, '本机中转无法连接 ' + target.origin + '：' + error.message);
      else res.destroy();
    });
    upstream.end(body);
  });
});

server.on('error', error => { console.error('中转启动失败: ' + error.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  console.log('本机中转已启动: http://127.0.0.1:' + port + '  ->  ' + target.origin);
  console.log('扩展里填: http://127.0.0.1:' + port + '<原来的路径，例如 /v1>');
  console.log('按 Ctrl+C 停止。');
});
