import test, {before, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import sharp from 'sharp';

// Every fixture is local and disposable. Unexpected network access fails closed.
const dir = mkdtempSync(path.join(tmpdir(), 'hooboo-split-'));
const savedFetch = globalThis.fetch;
const envKeys = ['DATA_DIR', 'STORAGE_MODE', 'ALLOW_MEMORY_QA', 'APP_ORIGIN',
  'SETUP_TOKEN', 'WORKER_TOKEN', 'MAX_STORAGE_BYTES', 'R2_BRIDGE_URL', 'R2_BRIDGE_TOKEN'];
const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {
  DATA_DIR: dir, STORAGE_MODE: 'memory', ALLOW_MEMORY_QA: '1',
  APP_ORIGIN: 'https://example.test', SETUP_TOKEN: randomBytes(32).toString('hex'),
  WORKER_TOKEN: randomBytes(32).toString('hex'),
});
delete process.env.MAX_STORAGE_BYTES;
const {handle} = await import('../lib/api.mjs');
const {publicImage} = await import('../lib/media.mjs');
const {db, one, all, run} = await import('../lib/db.mjs');
const {hashPassword} = await import('../lib/security.mjs');
const originals = await Promise.all(['#91aa73', '#947bb1', '#799cbe'].map(background =>
  sharp({create: {width: 120, height: 80, channels: 3, background}}).png().toBuffer()));
const translated = await sharp({create: {
  width: 120, height: 80, channels: 3, background: '#27394f',
}}).png().toBuffer();
const bearer = {authorization: 'Bearer ' + process.env.WORKER_TOKEN};
let admin, owner, other;
let unexpectedNetworkCalls = 0;

async function request(route, {method = 'GET', headers = {}, body} = {}) {
  const h = {host: 'example.test', ...(method === 'GET' ? {} : {origin: process.env.APP_ORIGIN}), ...headers};
  for (const key of Object.keys(h)) if (h[key] == null) delete h[key];
  let content = body;
  if (body != null && !(body instanceof FormData)) {
    h['content-type'] = 'application/json';
    content = JSON.stringify(body);
  }
  return handle(new Request('https://example.test/api/' + route, {
    method, headers: h, body: content,
  }), route.split('?')[0].split('/'));
}
async function call(route, options = {}) {
  const response = await request(route, options);
  assert.equal(response.status, options.status ?? 200,
    route + ': ' + (response.status !== (options.status ?? 200) ? await response.clone().text() : ''));
  return response;
}
async function json(route, options) { return (await call(route, options)).json(); }
async function login(username, password) {
  const response = await call('login', {method: 'POST', body: {username, password}});
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const session = await json('session', {headers: {cookie}});
  return {cookie, 'x-csrf-token': session.user.csrf};
}
function uploadForm(count = 2) {
  const body = new FormData();
  body.set('title', '合并原稿：食物、动物与日常');
  body.set('text', '原始合并说明，保留在来源上下文。');
  body.set('source', 'https://source.example.test/posts/original');
  body.set('credit', '原作者 · 图片授权署名');
  for (let i = 0; i < count; i++) {
    body.append('images', new File([originals[i % originals.length]], `original-${i}.png`, {type: 'image/png'}));
  }
  return body;
}
function imageForm(bytes = translated) {
  const body = new FormData();
  body.set('image', new File([bytes], 'english.png', {type: 'image/png'}));
  return body;
}
async function create(count = 2) {
  return (await json('submissions', {method: 'POST', headers: {
    ...owner, 'idempotency-key': randomUUID(),
  }, body: uploadForm(count), status: 201})).id;
}
async function split(id, options = {}) {
  return json(`admin/submissions/${id}/split`, {method: 'POST', headers: admin, ...options});
}
async function claim(headers = admin, key = randomUUID()) {
  return (await json('worker/claim', {method: 'POST', headers: {...headers, 'idempotency-key': key}})).submission;
}
function jobHeaders(job, headers = admin) { return {...headers, 'x-job-lease': job.lease}; }
async function uploadOutput(job, position, headers = admin) {
  return json(`worker/articles/${job.id}/images/${position}`, {
    method: 'PUT', headers: jobHeaders(job, headers), body: imageForm(),
  });
}
const completion = {title_en: 'An independently translated image', text_en: 'Reviewed English description.'};
async function complete(job, headers = admin) {
  for (const original of job.originals) await uploadOutput(job, original.position, headers);
  return json(`worker/articles/${job.id}/complete`, {method: 'POST', headers: jobHeaders(job, headers), body: completion});
}
function rawArticle(id) { return one('SELECT * FROM articles WHERE id=?', id); }
function rawAssets(id) { return all('SELECT * FROM assets WHERE article_id=? ORDER BY kind,position,id', id); }
function state() {
  return Object.fromEntries(['articles', 'assets', 'article_splits', 'split_children', 'article_completions',
    'worker_claims', 'storage_reservations'].map(table => [table, all(`SELECT * FROM ${table} ORDER BY rowid`)]));
}
function assertParentPreserved(id, beforeArticle, beforeAssets) {
  assert.deepEqual(rawArticle(id), {...beforeArticle, lease: null, lease_until: null});
  assert.deepEqual(rawAssets(id), beforeAssets);
}
function storageStatus() {
  return JSON.parse(execFileSync(process.execPath, ['scripts/storage-status.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'), env: process.env, encoding: 'utf8',
  }));
}
function assertPublicShape(article) {
  for (const field of ['originals', 'title_cn', 'text_cn', 'provenance', 'split', 'parent_id',
    'source_asset_id', 'source_position', 'lease', 'lease_until', 'contributor', 'user_id']) {
    assert.ok(!(field in article), `Private field ${field} leaked into a public article`);
  }
  for (const image of article.images) assert.ok(!('filename' in image), 'Storage keys must remain private');
}
async function concurrentRequests(requests) {
  const startAt = Date.now() + 1000;
  const script = `
    globalThis.fetch = async () => { throw Error('Network forbidden in split race tests'); };
    const {handle} = await import('./lib/api.mjs');
    const {db} = await import('./lib/db.mjs');
    const delay = Number(process.env.SPLIT_START_AT) - Date.now();
    if (delay > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    const {route, headers} = JSON.parse(process.env.SPLIT_REQUEST);
    const response = await handle(new Request('https://example.test/api/' + route, {
      method: 'POST', headers: {host: 'example.test', origin: process.env.APP_ORIGIN,
        cookie: process.env.SPLIT_COOKIE, 'x-csrf-token': process.env.SPLIT_CSRF, ...headers}
    }), route.split('/'));
    console.log(JSON.stringify({status: response.status, body: await response.json()}));
    db.close();
  `;
  return Promise.all(requests.map(request => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: {...process.env, SPLIT_REQUEST: JSON.stringify(request), SPLIT_START_AT: String(startAt),
        SPLIT_COOKIE: admin.cookie, SPLIT_CSRF: admin['x-csrf-token']},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(Error(`Split process exited ${code}: ${errors}`));
      try { resolve(JSON.parse(output)); } catch { reject(Error(`Invalid split process output: ${output}\n${errors}`)); }
    });
  })));
}
async function requestAfterTransactionRead(first, second) {
  // Pause immediately after the first request reads its article in a transaction.
  // With an IMMEDIATE transaction this process already owns the SQLite writer lock.
  // A deferred publication would instead permit the split to commit and then fail
  // upgrading its old read snapshot with SQLITE_BUSY, which this test catches.
  const script = `
    globalThis.fetch = async () => { throw Error('Network forbidden in publication race tests'); };
    const {handle} = await import('./lib/api.mjs');
    const {db} = await import('./lib/db.mjs');
    const {route, headers, articleId} = JSON.parse(process.env.SPLIT_REQUEST);
    const prepare = db.prepare.bind(db);
    let paused = false;
    db.prepare = function(sql) {
      const statement = prepare(sql);
      if (sql === 'SELECT * FROM articles WHERE id=?' ||
          sql === 'SELECT * FROM articles WHERE id=? AND user_id=?') {
        const get = statement.get.bind(statement);
        statement.get = function(...args) {
          const result = get(...args);
          if (!paused && db.inTransaction && args[0] === articleId) {
            paused = true;
            process.send({phase: 'article-read'});
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
          }
          return result;
        };
      }
      return statement;
    };
    const response = await handle(new Request('https://example.test/api/' + route, {
      method: 'POST', headers: {host: 'example.test', origin: process.env.APP_ORIGIN, ...headers}
    }), route.split('/'));
    console.log(JSON.stringify({status: response.status, body: await response.json()}));
    db.close();
    process.disconnect();
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {...process.env, SPLIT_REQUEST: JSON.stringify(first)},
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '', errors = '', readTimer;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const read = new Promise((resolve, reject) => {
    readTimer = setTimeout(() => reject(Error('First request never reached its transactional article read')), 5000);
    child.on('message', message => {
      if (message.phase === 'article-read') { clearTimeout(readTimer); resolve(); }
    });
    child.on('error', reject);
    child.on('close', () => reject(Error(`First request exited before the expected transaction read: ${output}\n${errors}`)));
  });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(Error(`Publication race process exited ${code}: ${errors}`));
      try { resolve(JSON.parse(output)); } catch { reject(Error(`Invalid publication race output: ${output}\n${errors}`)); }
    });
  });
  // Attach a handler immediately so an early spawn failure cannot become an
  // unhandled rejection while the test is awaiting the separate read signal.
  finished.catch(() => {});
  try {
    await read;
    const response = await request(second.route, {method: 'POST', headers: second.headers});
    return [await finished, {status: response.status, body: await response.json()}];
  } finally {
    clearTimeout(readTimer);
    if (child.exitCode === null) child.kill();
    await finished.catch(() => {});
  }
}

before(async () => {
  const password = randomBytes(24).toString('hex');
  const hash = hashPassword(password);
  for (const [id, username, role] of [
    ['admin', 'split_admin', 'admin'], ['owner', 'split_owner', 'contributor'], ['other', 'split_other', 'contributor'],
  ]) run('INSERT INTO users (id,username,password,created,role) VALUES (?,?,?,?,?)', id, username, hash, Date.now(), role);
  admin = await login('split_admin', password);
  owner = await login('split_owner', password);
  other = await login('split_other', password);
});
beforeEach(() => {
  process.env.STORAGE_MODE = 'memory';
  delete process.env.MAX_STORAGE_BYTES;
  delete process.env.R2_BRIDGE_URL;
  delete process.env.R2_BRIDGE_TOKEN;
  unexpectedNetworkCalls = 0;
  globalThis.fetch = async () => { unexpectedNetworkCalls++; throw Error('Network access is forbidden in split tests'); };
  db.transaction(() => {
    for (const table of ['split_children', 'article_splits', 'article_completions', 'assets', 'articles',
      'worker_claims', 'storage_reservations', 'storage_alerts', 'limits']) run(`DELETE FROM ${table}`);
  })();
});
after(() => {
  globalThis.fetch = savedFetch;
  db.close();
  rmSync(dir, {recursive: true, force: true});
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('split requires a live admin session, matching Origin and CSRF; denial cannot mutate source data', async () => {
  const id = await create();
  const before = state();
  for (const [headers, status] of [
    [{}, 401], [owner, 403], [other, 403], [bearer, 401],
    [{...owner, ...bearer}, 403], [{cookie: admin.cookie}, 403],
    [{...admin, 'x-csrf-token': 'incorrect'}, 403],
    [{...admin, origin: 'https://evil.example.test'}, 403], [{...admin, origin: null}, 403],
  ]) {
    await split(id, {headers, status});
    assert.deepEqual(state(), before);
  }
  await split(randomUUID(), {status: 404});
  assert.deepEqual(state(), before);
  run("UPDATE users SET role='contributor' WHERE id='admin'");
  try { await split(id, {status: 403}); } finally { run("UPDATE users SET role='admin' WHERE id='admin'"); }
  const expiry = one("SELECT expires FROM sessions WHERE user_id='admin'").expires;
  run("UPDATE sessions SET expires=0 WHERE user_id='admin'");
  try { await split(id, {status: 401}); } finally { run("UPDATE sessions SET expires=? WHERE user_id='admin'", expiry); }
  assert.deepEqual(state(), before);
  const result = await split(id); // Deliberately no request body or content type.
  assert.equal(result.ok, true);
  assert.equal(result.parent_id, id);
  assert.equal(result.already_split, false);
});

test('one private child per original preserves bytes, order, attribution and source history without storage operations', async () => {
  const id = await create(3);
  const beforeArticle = rawArticle(id), beforeAssets = rawAssets(id), used = storageStatus().usedBytes;
  process.env.STORAGE_MODE = 'r2'; // Any accidental storage read/write/delete would hit the fail-closed fetch stub.
  process.env.R2_BRIDGE_URL = 'https://storage.invalid.test';
  process.env.R2_BRIDGE_TOKEN = 'isolated-test-token';
  process.env.MAX_STORAGE_BYTES = '1'; // Splitting aliases must work even when storage is already full.
  const result = await split(id);
  assert.equal(unexpectedNetworkCalls, 0);
  process.env.STORAGE_MODE = 'memory';
  delete process.env.MAX_STORAGE_BYTES;
  assert.equal(result.children.length, 3);
  assert.equal(new Set(result.children.map(child => child.id)).size, 3);
  assertParentPreserved(id, beforeArticle, beforeAssets);
  assert.equal(one('SELECT COUNT(*) AS n FROM article_splits').n, 1);
  assert.equal(one('SELECT created_by FROM article_splits WHERE parent_id=?', id).created_by, 'admin');
  assert.equal(one('SELECT COUNT(*) AS n FROM split_children').n, 3);
  assert.equal(one('SELECT COUNT(*) AS n FROM storage_reservations').n, 0);
  assert.equal(storageStatus().usedBytes, used);
  for (const [position, child] of result.children.entries()) {
    const source = beforeAssets[position], raw = rawArticle(child.id), alias = rawAssets(child.id)[0];
    assert.notEqual(child.id, id);
    assert.equal(raw.user_id, beforeArticle.user_id);
    assert.equal(child.status, 'pending');
    assert.equal(raw.status, 'pending');
    assert.equal(raw.approved, 0);
    assert.ok(!raw.title_en && !raw.text_en && !raw.error && !raw.lease && !raw.published);
    assert.equal(raw.text_cn, '');
    assert.equal(raw.credit, beforeArticle.credit);
    assert.equal(raw.source, beforeArticle.source);
    assert.equal(child.contributor, 'split_owner');
    assert.deepEqual(child.images, []);
    assert.equal(child.originals.length, 1);
    assert.equal(child.originals[0].position, 0);
    assert.deepEqual(child.provenance, {
      parent_id: id, source_asset_id: source.id, source_position: position,
      parent_title_cn: beforeArticle.title_cn, parent_text_cn: beforeArticle.text_cn,
    });
    assert.notEqual(alias.id, source.id);
    assert.deepEqual(alias, {...source, id: alias.id, article_id: child.id, position: 0});
    const link = one('SELECT * FROM split_children WHERE child_id=?', child.id);
    assert.deepEqual(link, {parent_id: id, source_asset_id: source.id, source_position: position, child_id: child.id});
    for (const headers of [owner, admin]) {
      const media = await call('media/' + alias.id + '?download=1', {headers});
      assert.match(media.headers.get('cache-control'), /no-store/);
      assert.deepEqual(Buffer.from(await media.arrayBuffer()), originals[position]);
    }
    await call('media/' + alias.id, {status: 404});
    await call('media/' + alias.id, {headers: other, status: 404});
    assert.equal((await publicImage(alias.id + '.png')).status, 404);
    await call('articles/' + child.id, {status: 404});
  }
  const privateParent = (await json('admin/submissions/' + id, {headers: admin})).article;
  assert.equal(privateParent.status, 'split');
  assert.equal(privateParent.split.children.length, 3);
  assert.deepEqual(privateParent.split.children.map(child => child.id), result.children.map(child => child.id));
  assert.deepEqual(privateParent.split.children.map(child => child.source_position), [0, 1, 2]);
  const history = (await json('submissions', {headers: owner})).articles;
  assert.equal(history.find(article => article.id === id).status, 'split');
  assert.equal(history.length, 4);
  assert.deepEqual((await json('submissions', {headers: other})).articles, []);
  assert.deepEqual((await json('articles')).articles, []);
  for (const source of beforeAssets) {
    await call('media/' + source.id, {status: 404});
    assert.equal((await publicImage(source.id + '.png')).status, 404);
    assert.deepEqual(Buffer.from(await (await call('media/' + source.id, {headers: owner})).arrayBuffer()), originals[source.position]);
  }
});

test('split enforces the original image bounds, including corrupt zero/21-image records', async () => {
  for (const count of [0, 1, 21]) {
    const id = await create(count === 21 ? 20 : 1);
    if (!count) run('DELETE FROM assets WHERE article_id=?', id);
    if (count === 21) {
      const a = rawAssets(id)[0];
      run('INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?)', randomUUID(), id, 20, 'original', a.filename, a.mime, a.width, a.height, a.bytes);
    }
    const before = state();
    await split(id, {status: 409});
    assert.deepEqual(state(), before);
  }
  const id = await create(20), result = await split(id);
  assert.equal(result.children.length, 20);
  assert.deepEqual(result.children.map(child => child.provenance.source_position), Array.from({length: 20}, (_, i) => i));
});

test('a published source is immutable, and existing full-image completion/publication checks still apply', async () => {
  const id = await create(2), job = await claim();
  assert.equal(job.id, id);
  const headers = jobHeaders(job);
  await json(`worker/articles/${id}/complete`, {method: 'POST', headers, body: completion, status: 409});
  await uploadOutput(job, 0);
  await json(`worker/articles/${id}/complete`, {method: 'POST', headers, body: completion, status: 409});
  await call(`worker/articles/${id}/publish`, {method: 'POST', headers: admin, status: 409});
  await uploadOutput(job, 1);
  // Matching counts alone are insufficient: the translated positions must cover every original.
  run("UPDATE assets SET position=2 WHERE article_id=? AND kind='english' AND position=1", id);
  await json(`worker/articles/${id}/complete`, {method: 'POST', headers, body: completion, status: 409});
  assert.equal(one('SELECT COUNT(*) AS n FROM article_completions').n, 0);
  run("UPDATE assets SET position=1 WHERE article_id=? AND kind='english' AND position=2", id);
  const completed = await json(`worker/articles/${id}/complete`, {method: 'POST', headers, body: completion});
  assert.equal(completed.already_completed, false);
  assert.equal((await json(`worker/articles/${id}/complete`, {method: 'POST', headers, body: completion})).already_completed, true);
  await call(`worker/articles/${id}/publish`, {method: 'POST', headers: admin});
  const before = state();
  await split(id, {status: 409});
  assert.deepEqual(state(), before);
  assert.equal((await json(`worker/articles/${id}/complete`, {method: 'POST', headers, body: completion})).already_completed, true);
  await call(`worker/articles/${id}/complete`, {method: 'POST', headers, body: {...completion, title_en: 'Changed'}, status: 409});
  await call(`worker/articles/${id}/complete`, {method: 'POST', headers: {...headers, 'x-job-lease': 'stale'}, body: completion, status: 409});
  assert.deepEqual(state(), before);
  const article = (await json('articles/' + id)).article;
  assert.equal(article.images.length, 2);
  assertPublicShape(article);
});

test('ready source English assets and raw history survive a split, but parent publication and completion stay blocked', async () => {
  const id = await create(), job = await claim();
  await complete(job);
  run('UPDATE articles SET approved=1 WHERE id=?', id);
  const beforeArticle = rawArticle(id), beforeAssets = rawAssets(id);
  const result = await split(id);
  assertParentPreserved(id, beforeArticle, beforeAssets);
  for (const child of result.children) {
    assert.deepEqual(child.images, []);
    assert.equal(rawArticle(child.id).approved, 0);
  }
  for (const headers of [admin, bearer]) await call(`worker/articles/${id}/publish`, {method: 'POST', headers, status: 409});
  await call(`submissions/${id}/publish`, {method: 'POST', headers: owner, status: 409});
  await call(`worker/articles/${id}/complete`, {method: 'POST', headers: jobHeaders(job), body: completion, status: 409});
  for (const asset of beforeAssets) {
    await call('media/' + asset.id, {status: 404});
    assert.equal((await publicImage(asset.id + '.png')).status, 404);
  }
  assertParentPreserved(id, beforeArticle, beforeAssets);
});

test('active leases require the exact token; splitting invalidates old claims and every stale worker mutation', async () => {
  const id = await create(), key = randomUUID(), job = await claim(admin, key);
  const before = state(), beforeArticle = rawArticle(id), beforeAssets = rawAssets(id);
  await split(id, {status: 409});
  await split(id, {headers: {...admin, 'x-job-lease': 'wrong'}, status: 409});
  assert.deepEqual(state(), before);
  const result = await split(id, {headers: jobHeaders(job)});
  assertParentPreserved(id, beforeArticle, beforeAssets);
  await call('worker/claim', {method: 'POST', headers: {...admin, 'idempotency-key': key}, status: 409});
  for (const op of ['heartbeat', 'complete', 'fail']) {
    await call(`worker/articles/${id}/${op}`, {method: 'POST', headers: jobHeaders(job), body: {
      ...completion, error: 'A stale worker must not modify a split parent',
    }, status: 409});
  }
  await call(`worker/articles/${id}/images/0`, {method: 'PUT', headers: jobHeaders(job), body: imageForm(), status: 409});
  for (const prefix of ['admin/submissions', 'submissions']) {
    await call(`${prefix}/${id}/retry`, {method: 'POST', headers: prefix.startsWith('admin') ? admin : owner, status: 409});
  }
  const children = new Set(result.children.map(child => child.id));
  for (let i = 0; i < children.size; i++) {
    const next = await claim(bearer);
    assert.ok(children.has(next.id));
    assert.notEqual(next.id, id);
  }
  assert.equal(await claim(bearer), null);
  assertParentPreserved(id, beforeArticle, beforeAssets);
});

test('expired processing and failed parents split safely and can never reenter the queue through retries', async () => {
  for (const status of ['processing', 'failed']) {
    const id = await create();
    run('UPDATE articles SET status=?,lease=?,lease_until=0,error=? WHERE id=?', status, 'expired-lease', 'Historical failure', id);
    const beforeArticle = rawArticle(id), beforeAssets = rawAssets(id);
    await split(id);
    assertParentPreserved(id, beforeArticle, beforeAssets);
    await call(`admin/submissions/${id}/retry`, {method: 'POST', headers: admin, status: 409});
    await call(`submissions/${id}/retry`, {method: 'POST', headers: owner, status: 409});
  }
  const parents = new Set(all('SELECT parent_id FROM article_splits').map(row => row.parent_id));
  let claimed = 0;
  for (;;) {
    const job = await claim();
    if (!job) break;
    assert.ok(!parents.has(job.id));
    claimed++;
    assert.ok(claimed <= 4, 'Queue must terminate without reclaiming a split parent');
  }
  assert.equal(claimed, 4);
});

test('children publish independently; duplicate split after publication cannot recreate, approve or requeue them', async () => {
  const id = await create(3), initial = await split(id), ids = initial.children.map(child => child.id);
  const simultaneous = await Promise.all(Array.from({length: 5}, () => split(id)));
  for (const result of simultaneous) {
    assert.equal(result.already_split, true);
    assert.deepEqual(result.children.map(child => child.id), ids);
  }
  const published = new Set();
  for (let i = 0; i < 3; i++) {
    const job = await claim();
    assert.ok(ids.includes(job.id));
    assert.ok(!published.has(job.id));
    assert.equal(job.originals.length, 1);
    await complete(job);
    await call(`worker/articles/${job.id}/publish`, {method: 'POST', headers: bearer, status: 409});
    await call(`worker/articles/${job.id}/publish`, {method: 'POST', headers: admin});
    published.add(job.id);
    const article = (await json('articles/' + job.id)).article;
    assert.equal(article.images.length, 1);
    assert.equal(article.credit, rawArticle(id).credit);
    assert.equal(article.source, rawArticle(id).source);
    assertPublicShape(article);
    const image = await publicImage(article.images[0].id + '.png');
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), translated);
    await call('media/' + job.originals[0].id, {status: 404});
    assert.equal((await publicImage(job.originals[0].id + '.png')).status, 404);
    assert.equal(rawArticle(job.id).approved, 0);
  }
  const before = state(), repeated = await split(id);
  assert.equal(repeated.already_split, true);
  assert.deepEqual(repeated.children.map(child => child.id), ids);
  assert.ok(repeated.children.every(child => child.status === 'published'));
  assert.deepEqual(state(), before);
  assert.equal(await claim(), null);
  const listing = (await json('articles')).articles;
  assert.equal(listing.length, 3);
  assert.deepEqual(new Set(listing.map(article => article.id)), published);
  listing.forEach(assertPublicShape);
  await call('articles/' + id, {status: 404});
  const parent = (await json('submissions', {headers: owner})).articles.find(article => article.id === id);
  assert.equal(parent.status, 'split');
  assert.ok(parent.split.children.every(child => child.status === 'published'));
});

test('split creation rolls back the parent marker, every child, alias and lease change on an intermediate failure', async () => {
  const id = await create(3), job = await claim(), before = state();
  db.exec(`CREATE TEMP TRIGGER reject_second_split_child BEFORE INSERT ON split_children
    WHEN NEW.source_position=1 BEGIN SELECT RAISE(ABORT,'injected split failure'); END;`);
  try {
    await split(id, {headers: jobHeaders(job), status: 500});
    assert.deepEqual(state(), before);
  } finally {
    db.exec('DROP TRIGGER reject_second_split_child');
  }
  await call(`worker/articles/${id}/heartbeat`, {method: 'POST', headers: jobHeaders(job)});
  const result = await split(id, {headers: jobHeaders(job)});
  assert.equal(result.children.length, 3);
  assert.equal(result.already_split, false);
});

test('storage quotas and status account for unique physical objects rather than split asset aliases', async () => {
  const id = await create(3), used = storageStatus().usedBytes;
  await split(id);
  assert.ok(one('SELECT SUM(bytes) AS n FROM assets').n > used, 'Fixture must contain aliases');
  assert.equal(storageStatus().usedBytes, used);
  process.env.MAX_STORAGE_BYTES = String(used + originals[0].length);
  await create(1); // Must fit exactly; counting aliases would incorrectly reject this.
  assert.equal(storageStatus().remainingBytes, 0);
  await call('submissions', {method: 'POST', headers: {...owner, 'idempotency-key': randomUUID()}, body: uploadForm(1), status: 507});
  const report = storageStatus();
  assert.equal(report.usedBytes, used + originals[0].length);
  assert.equal(report.reservedBytes, 0);
  assert.equal(report.quotaBlocked.usedBytes, report.usedBytes);
  assert.equal(report.quotaBlocked.requestedBytes, originals[0].length);
});

test('a translated upload already in flight cannot commit after its parent splits', {timeout: 15000}, async () => {
  const objects = new Map(), calls = [];
  let releasePut, putStarted;
  const released = new Promise(resolve => { releasePut = resolve; });
  const started = new Promise(resolve => { putStarted = resolve; });
  let holdEnglish = false;
  process.env.STORAGE_MODE = 'r2';
  process.env.R2_BRIDGE_URL = 'https://storage.invalid.test';
  process.env.R2_BRIDGE_TOKEN = 'isolated-test-token';
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(new URL(url).origin, process.env.R2_BRIDGE_URL);
    const key = new URL(url).pathname.slice(1), method = options.method ?? 'GET';
    calls.push({key, method});
    if (method === 'PUT') {
      objects.set(key, Buffer.from(options.body));
      if (holdEnglish && key.startsWith('english/')) { putStarted(); await released; }
      return new Response(null, {status: 200});
    }
    if (method === 'DELETE') { objects.delete(key); return new Response(null, {status: 200}); }
    return objects.has(key) ? new Response(objects.get(key)) : new Response(null, {status: 404});
  };
  const id = await create(), job = await claim();
  const beforeArticle = rawArticle(id), beforeAssets = rawAssets(id);
  holdEnglish = true;
  const pendingUpload = request(`worker/articles/${id}/images/0`, {method: 'PUT', headers: jobHeaders(job), body: imageForm()});
  let timer;
  try {
    await Promise.race([started, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Upload never reached the isolated R2 bridge')), 5000);
    })]);
    clearTimeout(timer);
    const beforeSplitCalls = calls.length;
    const result = await split(id, {headers: jobHeaders(job)});
    assert.equal(result.children.length, 2);
    assert.equal(calls.length, beforeSplitCalls, 'Split itself must not read, write or delete R2 objects');
    releasePut();
    const response = await pendingUpload;
    assert.equal(response.status, 409, await response.clone().text());
    assertParentPreserved(id, beforeArticle, beforeAssets);
    assert.equal(one("SELECT COUNT(*) AS n FROM assets WHERE kind='english'").n, 0);
    assert.equal(one('SELECT COUNT(*) AS n FROM storage_reservations').n, 0);
    assert.equal(objects.size, 2);
    assert.ok([...objects.keys()].every(key => key.startsWith('original/')));
    const written = calls.find(call => call.method === 'PUT' && call.key.startsWith('english/'));
    assert.ok(written);
    assert.ok(calls.some(call => call.method === 'DELETE' && call.key === written.key));
    for (const asset of beforeAssets) assert.deepEqual(objects.get(asset.filename), originals[asset.position]);
  } finally {
    clearTimeout(timer);
    releasePut();
    await pendingUpload;
  }
});

test('concurrent processes serialize duplicate split requests into one stable child set', {timeout: 20000}, async () => {
  const id = await create(3);
  const results = await concurrentRequests(Array.from({length: 4}, () => ({route: `admin/submissions/${id}/split`})));
  const ids = results[0].body.children?.map(child => child.id);
  for (const result of results) {
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.children.map(child => child.id), ids);
  }
  assert.equal(results.filter(result => result.body.already_split === false).length, 1);
  assert.equal(results.filter(result => result.body.already_split === true).length, 3);
  assert.equal(one('SELECT COUNT(*) AS n FROM article_splits').n, 1);
  assert.equal(one('SELECT COUNT(*) AS n FROM split_children').n, 3);
  assert.equal(one('SELECT COUNT(*) AS n FROM articles').n, 4);
  assert.equal(one('SELECT COUNT(*) AS n FROM assets').n, 6);
});

test('a competing worker claim and split serialize without creating two active jobs for a source', {timeout: 20000}, async () => {
  const id = await create(), key = randomUUID();
  const [splitResponse, claimResponse] = await concurrentRequests([
    {route: `admin/submissions/${id}/split`},
    {route: 'worker/claim', headers: {'idempotency-key': key}},
  ]);
  assert.equal(claimResponse.status, 200, JSON.stringify(claimResponse.body));
  const job = claimResponse.body.submission;
  assert.ok(job);
  if (splitResponse.status === 409) {
    assert.equal(job.id, id, 'Only the parent winning an active claim may block the split');
    assert.equal(one('SELECT COUNT(*) AS n FROM article_splits').n, 0);
    assert.equal(rawArticle(id).lease, job.lease);
    await split(id, {headers: jobHeaders(job)});
    await call('worker/claim', {method: 'POST', headers: {...admin, 'idempotency-key': key}, status: 409});
  } else {
    assert.equal(splitResponse.status, 200, JSON.stringify(splitResponse.body));
    assert.notEqual(job.id, id);
    assert.ok(splitResponse.body.children.some(child => child.id === job.id));
    assert.equal((await claim(admin, key)).lease, job.lease);
  }
  assert.equal(one('SELECT COUNT(*) AS n FROM article_splits').n, 1);
  assert.equal(one('SELECT COUNT(*) AS n FROM split_children').n, 2);
  assert.equal(rawArticle(id).lease, null);
  assert.equal(rawArticle(id).lease_until, null);
  const before = state();
  await call(`admin/submissions/${id}/retry`, {method: 'POST', headers: admin, status: 409});
  await call(`submissions/${id}/retry`, {method: 'POST', headers: owner, status: 409});
  assert.deepEqual(state(), before);
});

for (const actor of ['administrator', 'contributor']) {
  test(`${actor} publication and splitting serialize in either winning order without SQLITE_BUSY or duplicates`, {timeout: 20000}, async () => {
    const headers = actor === 'administrator' ? admin : owner;
    const prefix = actor === 'administrator' ? 'worker/articles' : 'submissions';
    for (const winner of ['publish', 'split']) {
      const id = await create(), job = await claim();
      assert.equal(job.id, id);
      await complete(job);
      const beforeAssets = rawAssets(id);
      const publication = {route: `${prefix}/${id}/publish`, headers, articleId: id};
      const splitting = {route: `admin/submissions/${id}/split`, headers: admin, articleId: id};
      const [first, second] = await requestAfterTransactionRead(
        winner === 'publish' ? publication : splitting,
        winner === 'publish' ? splitting : publication,
      );
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(second.status, 409, JSON.stringify(second.body));
      assert.deepEqual(rawAssets(id), beforeAssets);
      if (winner === 'publish') {
        assert.equal(rawArticle(id).status, 'published');
        assert.equal(rawArticle(id).approved, actor === 'contributor' ? 1 : 0);
        assert.equal(one('SELECT COUNT(*) AS n FROM article_splits WHERE parent_id=?', id).n, 0);
        assert.equal(one('SELECT COUNT(*) AS n FROM split_children WHERE parent_id=?', id).n, 0);
        const before = state();
        await call(publication.route, {method: 'POST', headers});
        await split(id, {status: 409});
        assert.deepEqual(state(), before, 'A publication retry must be idempotent after winning the race');
      } else {
        assert.equal(rawArticle(id).status, 'ready');
        assert.equal(rawArticle(id).published, null);
        assert.equal(rawArticle(id).approved, 0);
        assert.equal(one('SELECT COUNT(*) AS n FROM article_splits WHERE parent_id=?', id).n, 1);
        assert.equal(one('SELECT COUNT(*) AS n FROM split_children WHERE parent_id=?', id).n, 2);
        const ids = first.body.children.map(child => child.id), before = state();
        assert.equal(new Set(ids).size, 2);
        const repeated = await split(id);
        assert.equal(repeated.already_split, true);
        assert.deepEqual(repeated.children.map(child => child.id), ids);
        await call(publication.route, {method: 'POST', headers, status: 409});
        assert.deepEqual(state(), before, 'Neither retry may duplicate or publish a split source');
      }
    }
  });
}
