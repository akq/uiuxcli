const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { fork, execFileSync } = require('node:child_process')

if (process.env.UIUX_RELOAD_FIXTURE) {
    require('webpack-dev-server').prototype.openBrowser = () => {}
    require('../src/script/build').coreDebug({
        dir: process.env.UIUX_RELOAD_FIXTURE,
        branches: ['host', 'remote'],
        port: Number(process.env.UIUX_RELOAD_HOST_PORT)
    }).catch(error => {
        console.error(error)
        process.exit(1)
    })
} else {
    const test = require('node:test')
    const assert = require('node:assert/strict')
    const WebSocket = require('ws')
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

    async function until(check, diagnostics) {
        for (let i = 0; i < 200; i++) {
            if (await check()) return
            await delay(100)
        }
        assert.fail('Live reload timed out\n' + diagnostics())
    }

    async function availablePorts() {
        const listeners = [net.createServer(), net.createServer()]
        try {
            await Promise.all(listeners.map(server =>
                new Promise(resolve => server.listen(0, '127.0.0.1', resolve))))
            return listeners.map(server => server.address().port)
        } finally {
            await Promise.all(listeners.map(server => new Promise(resolve => server.close(resolve))))
        }
    }

    async function read(url) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
            return response.ok ? response.text() : ''
        } catch (error) {
            // Recreating a dev server briefly closes its listening socket.
            if (error.name === 'TimeoutError' || error.cause?.code === 'ECONNREFUSED' ||
                error.cause?.code === 'ECONNRESET' || error.cause?.code === 'UND_ERR_SOCKET') return ''
            throw error
        }
    }

    test('CLI reloads source, new exports and package entry without exiting', { timeout: 90000 }, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uiux-live-test-'))
        const [hostPort, remotePort] = await availablePorts()
        const manifest = name => ({
            name: 'test_' + name,
            module: { './value': './src/value.js' },
            config: { shared: [], plugin: [], rule: [], dev: { open: false, client: { logging: 'none' } } }
        })
        for (const name of ['host', 'remote']) {
            const dir = path.join(root, name)
            for (const folder of ['src', 'public', 'node_modules']) fs.mkdirSync(path.join(dir, folder), { recursive: true })
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ main: './src/index.js' }))
            fs.writeFileSync(path.join(dir, 'yarn.lock'), '')
            fs.writeFileSync(path.join(dir, 'manifest.js'), 'module.exports = ' + JSON.stringify(manifest(name)))
            fs.writeFileSync(path.join(dir, 'src', 'value.js'), 'export default "initial";')
            fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'console.log("entry");')
        }
        fs.writeFileSync(path.join(root, 'host', 'public', 'domain.js'),
            '\nvar port = ' + JSON.stringify({ test_host: { latest: hostPort }, test_remote: { latest: remotePort } }) + '\n')
        execFileSync('git', ['init', '--quiet', root])
        const child = fork(__filename, [], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, UIUX_RELOAD_FIXTURE: root, UIUX_RELOAD_HOST_PORT: String(hostPort) },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc']
        })
        let logs = ''
        for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { logs = (logs + data).slice(-100000) })
        let socket
        const remoteUrl = `http://127.0.0.1:${remotePort}/remoteEntry.js`
        const hostUrl = `http://127.0.0.1:${hostPort}`
        const configPath = path.join(root, 'remote', 'manifest.js')
        try {
            await until(async () => (await read(remoteUrl)).includes('"./value"'), () => logs)
            await until(async () => (await read(hostUrl + '/remoteEntry.js')).includes('"./value"'), () => logs)
            socket = new WebSocket(`ws://127.0.0.1:${hostPort}/ws`, { origin: hostUrl })
            let reloads = 0
            socket.on('message', data => {
                if (JSON.parse(data).type === 'static-changed') reloads++
            })
            await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
            fs.writeFileSync(path.join(root, 'remote', 'src', 'value.js'), 'export default "source changed";')
            await until(() => reloads > 0, () => logs)

            let previous = reloads
            const next = manifest('remote')
            next.module['./added'] = './src/value.js'
            fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify(next))
            await until(async () => (await read(remoteUrl)).includes('"./added"') && reloads > previous, () => logs)
            fs.writeFileSync(configPath, 'module.exports = { invalid syntax')
            await until(() => logs.includes('Invalid configuration'), () => logs)
            assert.ok((await read(remoteUrl)).includes('"./added"'))
            previous = reloads
            fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify(next))
            await until(() => reloads > previous, () => logs)

            next.config.dev.invalidOption = true
            fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify(next))
            await until(() => logs.includes("unknown property 'invalidOption'"), () => logs)
            assert.ok((await read(remoteUrl)).includes('"./added"'))
            delete next.config.dev.invalidOption
            previous = reloads
            fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify(next))
            await until(() => reloads > previous, () => logs)

            previous = reloads
            fs.writeFileSync(path.join(root, 'remote', 'src', 'alternate.js'), 'console.log("alternate entry");')
            fs.writeFileSync(path.join(root, 'remote', 'package.json'), '{"main":"./src/alternate.js"}')
            await until(async () => (await read(`http://127.0.0.1:${remotePort}/main.js`)).includes('alternate entry') &&
                reloads > previous, () => logs)

            const response = await fetch(`${hostUrl}/_/action/stop/${remotePort}`)
            assert.ok(response.ok)
            next.module['./stopped'] = './src/value.js'
            fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify(next))
            await delay(750)
            assert.equal(await read(remoteUrl), '')
            assert.ok((await fetch(`${hostUrl}/_/action/start/${remotePort}`)).ok)
            await until(async () => (await read(remoteUrl)).includes('"./stopped"'), () => logs)
            const restarts = await Promise.all([1, 2].map(() =>
                fetch(`${hostUrl}/_/action/restart/${remotePort}`)))
            assert.ok(restarts.every(response => response.ok))
            await until(async () => (await read(remoteUrl)).includes('"./stopped"'), () => logs)
            assert.equal(child.exitCode, null)
            assert.ok(!logs.includes('EADDRINUSE'), logs)
        } finally {
            if (socket) socket.terminate()
            if (child.exitCode === null) {
                const exited = new Promise(resolve => child.once('exit', resolve))
                child.kill()
                await exited
            }
            fs.rmSync(root, { recursive: true })
        }
    })
}
