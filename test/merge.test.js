const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const { gitUrlToHttps, getGitFileUrls } = require('../src/script/git-url')

test('source links support SSH, HTTPS, GitHub and nested GitLab repositories', () => {
    for (const url of ['git@github.com:akq/uiuxcli.git', 'ssh://git@github.com:22/akq/uiuxcli.git',
        'https://github.com/akq/uiuxcli.git']) {
        assert.equal(gitUrlToHttps(url), 'https://github.com/akq/uiuxcli')
        assert.equal(getGitFileUrls(url, 'amp/html', './src/a b.js').blobUrl,
            'https://github.com/akq/uiuxcli/blob/amp/html/src/a%20b.js')
    }
    assert.equal(getGitFileUrls('git@gitlab.example.com:group/sub/repo.git', 'main').branchUrl,
        'https://gitlab.example.com/group/sub/repo/-/tree/main')
})

test('CLI retains out/serve, accepts target and prints its version in help', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'bin', 'uiux'), 'utf8')
    const messages = []
    let args
    let version = 0
    const mapper = {
        currentRemote: () => 'origin', repoFn: () => 'git@github.com:akq/uiuxcli.git',
        currentBranch: () => 'main', csv2arr: value => value.split(','),
        branchesFn: () => { throw new Error('Single-branch defaults must not scan remote branches') },
    }
    function run(argv) {
        vm.runInNewContext(source, {
            require: name => name === 'path' ? path : name.endsWith('/helper') ? { mapper } : {
                releaseOne: value => { args = value }, getVersion: () => { version++ },
            },
            process: { argv: ['node', 'uiux', ...argv], cwd: () => __dirname, exit: () => { throw new Error('exit') } },
            console: { log: value => messages.push(value), error: value => messages.push(value) },
            __dirname,
        })
    }
    run(['build', '--target', 'release', '--branches', 'amp/el,amp/html', '--mode', 'production'])
    assert.equal(args.target, 'release')
    assert.equal(args.branches.join(','), 'amp/el,amp/html')
    assert.equal(args.mode, 'production')
    run(['build', '--out', '.build', '--serve', '8123'])
    assert.equal(args.out, '.build')
    assert.equal(args.serve, '8123')
    assert.throws(() => run([]), /exit/)
    assert.equal(version, 1)
    assert.ok(messages.includes('Current Version:'))
})

test('debug template uses lowercase actions, valid URLs and correct port attributes', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'script', 'debug.tmpl.html'), 'utf8')
        .replaceAll('{{DEF_PORT}}', '1235')
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
    const elements = new Map()
    const element = selector => {
        if (!elements.has(selector)) elements.set(selector, { style: {}, disabled: true, textContent: '' })
        return elements.get(selector)
    }
    const urls = []
    const alerts = []
    const context = {
        document: {
            querySelector: element,
            querySelectorAll: () => ['3001', '3002'].map(port => ({
                href: `http://localhost:${port}/remoteEntry.js`, getAttribute: () => port,
            })),
        },
        fetch: async url => { urls.push(url); return { ok: true } },
        alert: message => alerts.push(message), Date, setTimeout, window: {},
    }
    vm.createContext(context)
    scripts.forEach(script => vm.runInContext(script, context))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(element('#toggle_3001').textContent, 'stop')
    assert.equal(element('#toggle_3002').textContent, 'stop')
    vm.runInContext("action({textContent:'Restart', disabled:false}, '3001')", context)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(urls.includes('http://localhost:1235/_/action/restart/3001'))
    vm.runInContext("action({textContent:'Stop', disabled:false}, '3001')", context)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(urls.includes('http://localhost:1235/_/action/stop/3001'))
    assert.equal(element('#toggle_3001').textContent, 'start')
    vm.runInContext("action({textContent:'Start', disabled:false}, '3001')", context)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(urls.includes('http://localhost:1235/_/action/start/3001'))
    assert.equal(element('#toggle_3001').textContent, 'stop')
    context.fetch = async () => ({ ok: false, status: 500 })
    vm.runInContext("action({textContent:'Restart', disabled:false}, '3001')", context)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(alerts.length, 1)
    assert.match(alerts[0], /HTTP 500/)
    assert.equal(element('#toggle_3001').disabled, false)
    assert.ok(html.includes('{{EXT_HTML}}'))
})

test('branch releases preserve target/out modes, exclusions and build failures', { timeout: 60000 }, async () => {
    const { releaseOne } = require('../src/script/build')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uiux-merge-build-'))
    execFileSync('git', ['init', '--quiet', root])
    const dir = path.join(root, 'amp', 'sample')
    for (const folder of ['src', 'public', 'node_modules']) fs.mkdirSync(path.join(dir, folder), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"./src/index.js"}')
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '')
    fs.writeFileSync(path.join(dir, 'manifest.js'), `module.exports = {
        name: 'merge_test', module: {'./value':'./src/index.js'}, config: { shared: [], plugin: [], rule: [] }
    }`)
    const entry = path.join(dir, 'src', 'index.js')
    fs.writeFileSync(entry, 'export default "release value";')
    try {
        const options = { base: root, dir, branches: ['amp/sample', 'amp/sample', 'excluded'], excludes: ['excluded'] }
        await releaseOne({ ...options, target: path.join(root, 'target'), mode: 'production' })
        const target = path.join(root, 'target')
        assert.ok(fs.existsSync(path.join(target, 'amp', 'sample', 'remoteEntry.js')))
        assert.ok(!fs.existsSync(path.join(target, 'index.html')))
        const main = fs.readFileSync(path.join(target, 'amp', 'sample', 'main.js'), 'utf8')
        assert.ok(!main.includes('webpackBootstrap'), 'Production mode was not applied')
        await releaseOne({ ...options, out: path.join(root, 'out') })
        for (const file of ['index.html', 'manifest.json', 'domain.js']) {
            assert.ok(fs.existsSync(path.join(root, 'out', file)))
        }
        await releaseOne(options)
        assert.ok(fs.existsSync(path.join(dir, 'dist', 'remoteEntry.js')))
        await assert.rejects(releaseOne({ ...options, target, out: target }), /either --out or --target/)
        fs.writeFileSync(entry, 'this is not valid javascript {{{')
        await assert.rejects(releaseOne({ ...options, target: path.join(root, 'bad') }), /compilation failed/)
    } finally {
        process.chdir(path.join(__dirname, '..'))
        fs.rmSync(root, { recursive: true })
    }
})
