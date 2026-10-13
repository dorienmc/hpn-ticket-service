import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const workerDirectory = fileURLToPath(new URL('../', import.meta.url));
const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const stateDirectory = process.env.E2E_STATE_DIR ?? mkdtempSync(join(tmpdir(), 'hpn-worker-e2e-'));
const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' };
const localArgs = ['--local', '--config', 'wrangler.local.jsonc', '--persist-to', stateDirectory];

const migration = spawnSync(process.execPath, [
  wrangler, 'd1', 'migrations', 'apply', 'hpn-ticket-service-prod', ...localArgs,
], { cwd: workerDirectory, env, stdio: 'inherit' });

if (migration.error || migration.status !== 0) {
  rmSync(stateDirectory, { recursive: true, force: true });
  if (migration.error) console.error(migration.error);
  process.exit(migration.status ?? 1);
}

const messages = [];
const mailSink = createServer(async (request, response) => {
  try {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST' && request.url === '/api/v1/send') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const id = String(messages.length + 1);
      messages.push({ ...JSON.parse(body), ID: id });
      response.end(JSON.stringify({ ID: id }));
    } else if (request.url?.startsWith('/api/v1/search')) {
      const query = new URL(request.url, 'http://localhost').searchParams.get('query') ?? '';
      const email = query.replace(/^to:/, '').toLowerCase();
      const matches = messages.filter((message) => message.To.some((recipient) => recipient.Email.toLowerCase() === email));
      response.end(JSON.stringify({
        messages_count: matches.length,
        messages: matches.toReversed().map((message) => ({
          ID: message.ID,
          To: message.To,
          From: message.From,
          Subject: message.Subject,
          Attachments: message.Attachments?.length ?? 0,
        })),
      }));
    } else {
      const partMatch = request.url?.match(/^\/api\/v1\/message\/([^/]+)\/part\/([^/]+)$/);
      if (request.method === 'GET' && partMatch) {
        const message = messages.find((candidate) => candidate.ID === decodeURIComponent(partMatch[1]));
        const attachment = message?.Attachments?.[Number(partMatch[2]) - 1];
        if (!attachment) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'Not found' }));
          return;
        }
        response.setHeader('Content-Type', attachment.ContentType);
        response.end(Buffer.from(attachment.Content, 'base64'));
        return;
      }

      const messageMatch = request.url?.match(/^\/api\/v1\/message\/([^/]+)$/);
      if (request.method === 'GET' && messageMatch) {
        const message = messages.find((candidate) => candidate.ID === decodeURIComponent(messageMatch[1]));
        if (!message) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: 'Not found' }));
          return;
        }
        response.end(JSON.stringify({
          ...message,
          Attachments: (message.Attachments ?? []).map((attachment, index) => ({
            PartID: String(index + 1),
            FileName: attachment.Filename,
            ContentType: attachment.ContentType,
            Size: Buffer.from(attachment.Content, 'base64').byteLength,
          })),
        }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: 'Not found' }));
      }
    }
  } catch (error) {
    console.error(error);
    response.statusCode = 500;
    response.end(JSON.stringify({ error: 'Test mail sink failed' }));
  }
});
mailSink.on('error', (error) => {
  console.error(error);
  rmSync(stateDirectory, { recursive: true, force: true });
  process.exit(1);
});
await new Promise((resolve) => mailSink.listen(8030, '127.0.0.1', resolve));

const child = spawn(process.execPath, [
  wrangler, 'dev', ...localArgs, '--ip', '127.0.0.1', '--port', '8789',
  '--var', 'FRONTEND_URL:http://localhost:5180/hpn-ticket-service/',
  '--var', 'MAILPIT_API_URL:http://127.0.0.1:8030',
  '--var', 'ADMIN_ALLOWED_EMAILS:admin@example.com',
  '--var', 'MAX_TICKETS_PER_RESERVATION:10',
], { cwd: workerDirectory, env, stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.once('error', (error) => {
  console.error(error);
  rmSync(stateDirectory, { recursive: true, force: true });
  process.exit(1);
});
child.once('exit', (code, signal) => {
  mailSink.close();
  rmSync(stateDirectory, { recursive: true, force: true });
  process.exit(signal ? 0 : code ?? 1);
});
