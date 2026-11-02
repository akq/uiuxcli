const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const watchConfig = require('../src/script/watch-config')

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
    for (let i = 0; i < 100; i++) {
        if (predicate()) return
        await delay(50)
    }
    assert.fail('Timed out waiting for configuration reload')
}

test('configuration watcher handles atomic saves, serialization and recovery', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uiux-config-test-'))
    fs.writeFileSync(path.join(dir, 'manifest.js'), 'initial')
    fs.writeFileSync(path.join(dir, 'package.json'), '{}')
    let calls = 0
    let active = 0
    let maximum = 0
    let rejectNext = false
    const errors = []
    const close = watchConfig(dir, async () => {
        calls++
        active++
        maximum = Math.max(maximum, active)
        try {
            await delay(300)
            if (rejectNext) {
                rejectNext = false
                throw new Error('Invalid test manifest')
            }
        } finally {
            active--
        }
    }, error => errors.push(error))
    try {
        fs.writeFileSync(path.join(dir, 'source.js'), 'not configuration')
        await delay(250)
        assert.equal(calls, 0)
        fs.writeFileSync(path.join(dir, 'manifest.tmp'), 'atomic save')
        fs.renameSync(path.join(dir, 'manifest.tmp'), path.join(dir, 'manifest.js'))
        await until(() => calls === 1)
        fs.writeFileSync(path.join(dir, 'package.json'), '{"main":"changed"}')
        await until(() => calls === 2 && active === 0)
        assert.equal(maximum, 1)
        fs.writeFileSync(path.join(dir, 'manifest.js'), 'atomic save')
        await delay(250)
        assert.equal(calls, 2)
        rejectNext = true
        fs.writeFileSync(path.join(dir, 'manifest.js'), 'invalid')
        await until(() => errors.length === 1)
        fs.writeFileSync(path.join(dir, 'manifest.js'), 'recovered')
        await until(() => calls === 4 && active === 0)
        assert.equal(errors[0].message, 'Invalid test manifest')
        close()
        fs.writeFileSync(path.join(dir, 'manifest.js'), 'after close')
        await delay(250)
        assert.equal(calls, 4)
    } finally {
        close()
        fs.rmSync(dir, { recursive: true })
    }
})
