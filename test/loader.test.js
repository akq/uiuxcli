const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const webpack = require('webpack')
const Plugin = require('../src/loader/loader')
const vm = require('node:vm')

test('CLI uses its built-in loader instead of the npm package', () => {
    const manifest = { name: 'internal_loader_test', module: {}, config: {} }
    const cfg = require('../src/config/tmpl.config')({ dir: __dirname, manifest })
    assert.ok(cfg.plugins[0] instanceof Plugin)
    assert.equal(Object.hasOwn(require('../package.json').dependencies, 'uiuxloader'), false)
    assert.equal(Object.hasOwn(require('../package-lock.json').packages[''].dependencies, 'uiuxloader'), false)
})

test('cached and changed compilations retain loader and container metadata', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uiux-loader-test-'))
    const entry = path.join(root, 'entry.js')
    fs.writeFileSync(entry, "import value from 'other_domain://value'; export default value;")
    const compiler = webpack({
        mode: 'development',
        context: root,
        entry: './entry.js',
        output: { path: path.join(root, 'out') },
        plugins: [new Plugin({ manifest: { name: 'recompile_test', module: { './entry': entry } } })]
    })
    try {
        for (let i = 0; i < 3; i++) {
            if (i === 1) fs.writeFileSync(entry, "import value from 'replacement_domain://value'; export default value;")
            await new Promise((resolve, reject) => compiler.run((error, stats) => {
                if (error) return reject(error)
                if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
                resolve()
            }))
            const sources = fs.readdirSync(path.join(root, 'out'))
                .filter(file => file.endsWith('.js'))
                .map(file => fs.readFileSync(path.join(root, 'out', file), 'utf8'))
            for (const source of sources) new vm.Script(source)
            const source = sources.join('\n')
            assert.ok(source.includes('__loader__:'), 'Loader runtime was omitted')
            assert.ok(source.includes('var manifest ='), 'Container manifest was omitted')
            assert.equal(source.split('var manifest =').length - 1, 1, 'Container metadata was injected twice')
        }
    } finally {
        await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()))
        fs.rmSync(root, { recursive: true })
    }
})
