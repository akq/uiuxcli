var fs = require('fs')
var path = require('path')

module.exports = function watchConfig(dir, reload, onError) {
    var files = ['manifest.js', 'package.json']
    var contents = new Map(files.map(file => [file, fs.readFileSync(path.join(dir, file), 'utf8')]))
    var timer
    var closed = false
    var queue = Promise.resolve()
    var watcher = fs.watch(dir, (event, file) => {
        if (file && !files.includes(file.toString())) return
        clearTimeout(timer)
        timer = setTimeout(() => {
            queue = queue.then(async () => {
                if (closed) return
                var changed = false
                for (var file of files) {
                    var content = fs.readFileSync(path.join(dir, file), 'utf8')
                    if (contents.get(file) !== content) {
                        contents.set(file, content)
                        changed = true
                    }
                }
                if (changed) await reload()
            }).catch(onError)
        }, 150)
    })
    watcher.on('error', onError)
    return () => {
        closed = true
        clearTimeout(timer)
        watcher.close()
    }
}
