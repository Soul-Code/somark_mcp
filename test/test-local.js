import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Every HTTP request in this suite stays on loopback and uses synthetic data.
const entryPoint = fileURLToPath(new URL('../build/index.js', import.meta.url))
const loopbackGuard = fileURLToPath(new URL('./fetch-loopback-only.js', import.meta.url))
const fixtureDir = await mkdtemp(join(tmpdir(), 'somark-mcp-test-'))
const fixturePath = join(fixtureDir, 'sample.pdf')
const fixtureBytes = Buffer.from('%PDF-1.4\n% Synthetic MCP upload fixture; no real document data.\n%%EOF\n')
await writeFile(fixturePath, fixtureBytes)
after(() => rm(fixtureDir, { recursive: true, force: true }))

function serverEnv(base, key = 'local-test-key') {
    const env = { ...process.env }
    delete env.SOMARK_API_BASE_URL
    delete env.SOMARK_API_KEY
    if (base !== undefined) env.SOMARK_API_BASE_URL = base
    if (key !== undefined) env.SOMARK_API_KEY = key
    return env
}

async function connect(t, base, key = 'local-test-key') {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ['--import', loopbackGuard, entryPoint],
        env: serverEnv(base, key),
        stderr: 'pipe',
    })
    let diagnostics = ''
    transport.stderr.on('data', (chunk) => { diagnostics += chunk.toString() })
    const client = new Client({ name: 'local-integration-test', version: '1.0.0' })
    const protocolErrors = []
    client.onerror = (error) => protocolErrors.push(error)
    t.after(async () => {
        try {
            await client.close()
        } finally {
            await transport.close()
        }
        assert.deepEqual(protocolErrors.map((error) => error.message), [], 'stdout must contain only MCP messages')
    })
    await client.connect(transport)
    return { client, diagnostics: () => diagnostics }
}

async function mockApi(t, { prefix = '/api/v1', status = 200, response } = {}) {
    const requests = []
    const errors = []
    const server = createServer(async (req, res) => {
        try {
            assert.equal(req.method, 'POST')
            assert.equal(req.url, `${prefix}/parse/sync`)
            assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/)
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const form = await new Request(`http://127.0.0.1${req.url}`, {
                method: 'POST', headers: req.headers, body: Buffer.concat(chunks),
            }).formData()
            requests.push(form)
            res.writeHead(status, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(response ?? {
                code: 0,
                message: 'success',
                data: {
                    task_id: 'local-task', error: null,
                    result: {
                        file_name: 'sample.pdf', imgs: [],
                        outputs: { markdown: '# Local test result', json: { pages: [{ text: 'Local test result' }] } },
                    },
                    metadata: { page_num: 1, file_type: 'pdf' },
                },
            }))
        } catch (error) {
            errors.push(error)
            res.writeHead(500).end('Mock contract assertion failed')
        }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(async () => {
        const closed = new Promise((resolve) => server.close(resolve))
        server.closeAllConnections()
        await closed
        assert.deepEqual(errors, [], 'API request must match the shared contract')
    })
    return { base: `http://127.0.0.1:${server.address().port}${prefix}`, requests }
}

function textContent(result) {
    return result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
}

async function extract(client, args = {}) {
    return client.callTool({ name: 'extract_document', arguments: { file_path: fixturePath, ...args } })
}

test('MCP initialization and tool discovery keep stdout protocol-only', { timeout: 10000 }, async (t) => {
    const { client } = await connect(t, 'http://127.0.0.1:1/api/v1')
    const { tools } = await client.listTools()
    assert.ok(tools.some((tool) => tool.name === 'extract_document'))
    const status = await client.callTool({ name: 'check_api_key', arguments: {} })
    assert.match(textContent(status), /API key is configured/)
})

for (const [name, prefix, suffix] of [
    ['online-style API prefix', '/api/v1', ''],
    ['private deployment with a path prefix and trailing slashes', '/tenant/somark/api/v1', '///'],
]) {
    test(name, { timeout: 10000 }, async (t) => {
        const api = await mockApi(t, { prefix })
        const { client } = await connect(t, ` ${api.base}${suffix} `, 'synthetic-key')
        const result = await extract(client, {
            output_formats: ['markdown', 'json'],
            element_formats: { image: 'none', table: 'markdown' },
            feature_config: { keep_header_footer: true },
        })
        assert.ok(!result.isError, textContent(result))
        assert.match(textContent(result), /# Local test result/)
        assert.match(textContent(result), /--- JSON ---/)
        assert.equal(api.requests.length, 1)
        const form = api.requests[0]
        assert.equal(form.get('api_key'), 'synthetic-key')
        assert.deepEqual(form.getAll('output_formats'), ['markdown', 'json'])
        assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), fixtureBytes)
        assert.equal(form.get('file').name, 'sample.pdf')
        assert.equal(form.get('file').type, 'application/pdf')
        assert.equal(JSON.parse(form.get('element_formats')).image, 'none')
        assert.equal(JSON.parse(form.get('element_formats')).table, 'markdown')
        assert.equal(JSON.parse(form.get('feature_config')).keep_header_footer, true)
    })
}

test('two MCP instances keep endpoints and API keys isolated', { timeout: 10000 }, async (t) => {
    const online = await mockApi(t)
    const privateApi = await mockApi(t, { prefix: '/internal/api/v1' })
    const first = await connect(t, online.base, 'online-synthetic-key')
    const second = await connect(t, privateApi.base, 'private-synthetic-key')
    const results = await Promise.all([extract(first.client), extract(second.client)])
    for (const result of results) assert.ok(!result.isError, textContent(result))
    assert.deepEqual(online.requests.map((form) => form.get('api_key')), ['online-synthetic-key'])
    assert.deepEqual(privateApi.requests.map((form) => form.get('api_key')), ['private-synthetic-key'])
})

test('missing API key stops the upload before an API request', { timeout: 10000 }, async (t) => {
    const api = await mockApi(t)
    const { client } = await connect(t, api.base, '')
    const result = await extract(client)
    assert.equal(result.isError, true)
    assert.match(textContent(result), /API key not configured/)
    assert.equal(api.requests.length, 0)
})

test('runtime key updates stay in their MCP instance without polluting stdout', { timeout: 10000 }, async (t) => {
    const api = await mockApi(t)
    const { client, diagnostics } = await connect(t, api.base, '')
    const configured = await client.callTool({ name: 'set_api_key', arguments: { api_key: 'runtime-synthetic-key' } })
    assert.ok(!configured.isError, textContent(configured))
    const result = await extract(client)
    assert.ok(!result.isError, textContent(result))
    assert.equal(api.requests[0].get('api_key'), 'runtime-synthetic-key')
    assert.ok(!diagnostics().includes('runtime-synthetic-key'))
})

test('an unreachable private endpoint reports its own address without a cloud fallback', { timeout: 10000 }, async (t) => {
    const base = 'http://127.0.0.1:1/private/api/v1'
    const { client } = await connect(t, base)
    const result = await extract(client)
    assert.equal(result.isError, true)
    assert.ok(textContent(result).includes(base))
    assert.ok(!textContent(result).includes('https://somark.cn/api/v1'))
})

test('invalid file and format arguments do not reach the API', { timeout: 10000 }, async (t) => {
    const api = await mockApi(t)
    const { client } = await connect(t, api.base)
    const missing = await extract(client, { file_path: join(fixtureDir, 'missing.pdf') })
    assert.equal(missing.isError, true)
    assert.match(textContent(missing), /File not found/)
    const unsupportedPath = join(fixtureDir, 'sample.txt')
    await writeFile(unsupportedPath, 'synthetic unsupported file')
    const unsupported = await extract(client, { file_path: unsupportedPath })
    assert.equal(unsupported.isError, true)
    assert.match(textContent(unsupported), /Unsupported file format/)
    const duplicate = await extract(client, { output_formats: ['json', 'json'] })
    assert.equal(duplicate.isError, true)
    assert.equal(api.requests.length, 0)
})

test('HTTP errors preserve the server status and message', { timeout: 10000 }, async (t) => {
    const api = await mockApi(t, { status: 401, response: { message: 'Synthetic authorization failure' } })
    const { client } = await connect(t, api.base)
    const result = await extract(client)
    assert.equal(result.isError, true)
    assert.match(textContent(result), /401.*Synthetic authorization failure/)
})

test('business errors with null data preserve the API error message', { timeout: 10000 }, async (t) => {
    const api = await mockApi(t, { response: { code: 1107, message: 'Synthetic invalid key', data: null } })
    const { client } = await connect(t, api.base)
    const result = await extract(client)
    assert.equal(result.isError, true)
    assert.match(textContent(result), /API error: Synthetic invalid key/)
})

test('an unset API base preserves the existing online default without making a request', { timeout: 10000 }, async (t) => {
    const { client, diagnostics } = await connect(t, undefined)
    await client.listTools()
    assert.match(diagnostics(), /https:\/\/somark\.cn\/api\/v1/)
})

for (const value of ['', '   ', 'not-a-url', 'ftp://example.test', 'https://user:secret@example.test/api', 'https://example.test/api?token=secret', 'https://example.test/api#fragment', 'https://example.test/api?', 'https://example.test/api#']) {
    test(`invalid API base is rejected: ${JSON.stringify(value)}`, { timeout: 10000 }, async (t) => {
        const child = spawn(process.execPath, ['--import', loopbackGuard, entryPoint], { env: serverEnv(value), stdio: ['pipe', 'pipe', 'pipe'] })
        t.after(() => { if (child.exitCode === null) child.kill() })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
        child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
        child.stdin.end()
        const [code] = await once(child, 'close')
        assert.notEqual(code, 0)
        assert.equal(stdout, '')
        assert.match(stderr, /SOMARK_API_BASE_URL/)
        assert.ok(!stderr.includes('user:secret') && !stderr.includes('token=secret'))
    })
}
