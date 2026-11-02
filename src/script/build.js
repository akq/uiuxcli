var Webpack = require('webpack')
var DevServ = require('webpack-dev-server')
var createCfg = require('../config/tmpl.config')
var path = require('path')
var fs = require('fs')
var http = require('http')
var watchConfig = require('./watch-config')
var { gitUrlToHttps, getGitFileUrls } = require('./git-url')

var {
    runCmd
    , exitOrThrow
    , runOrThrow
    , mapper
} = require('./helper')

// var { Worker } = require("worker_threads");

// //Create new worker
// var worker = new Worker("./worker.js");
// worker.on("message", result => {

// });


var j = path.join
function queueServerOperation(entry, operation) {
    var pending = entry.operation || Promise.resolve()
    var result = pending.then(operation, operation)
    entry.operation = result
    return result
}

function logStart(name, version, port) {
    console.log()
    console.log(`${name}@${version} : ${port}`)
    console.log(`\tStart with: http://localhost:${port}/_/action/start`)
    console.log(`\tStop with: http://localhost:${port}/_/action/stop`)
    console.log(`\tRestart with: http://localhost:${port}/_/action/restart`)
    console.log()
}
var cmd = {
    yarn(dir, hash) {
        if (!fs.existsSync(j(dir, 'package.json'))) {
            console.log('no package.json found, will not run yarn command.')
            return 0
        }
        var ret = runCmd(dir, `git diff --name-only --diff-filter=M` + (hash ? ` ${hash}..HEAD` : ''))
        var pkgUpdated = false
        if (!ret.code) {
            var files = ret.stdout.trim().split('\n')
            if (files.includes('package.json')) {
                pkgUpdated = true
                console.log(dir + '/package.json has been updated.')
            }
        }
        if (!pkgUpdated && fs.existsSync(j(dir, 'yarn.lock')) && fs.existsSync(j(dir, 'node_modules'))) {
            console.log('packages are already installed.', dir)
            return 0
        }
        console.log('running yarn...')
        exitOrThrow(runCmd(dir, `yarn`))

    }
    , getUiDeps(dir) {
        try {
            delete require.cache[require.resolve(j(dir, './package.json'))]
            var pkg = require(j(dir, './package.json'))
            return [pkg.uiDependencies, pkg.main]
        }
        catch (e) {
            throw new Error('Unable to read package.json in ' + dir, { cause: e })
        }
    }
    , prepare(dir, main, deps) {
        var p = j(dir, './manifest')
        delete require.cache[require.resolve(p)]
        var manifest = require(p)
        var origMods = manifest.module
        var module = {}
        for (var i in origMods) {
            if (origMods[i][0] === '.')
                module[i] = j(dir, origMods[i])
            else
                module[i] = j(dir, 'node_modules/', origMods[i])
        }
        var cfg = createCfg({
            dir
            , manifest: { main, lock: deps, ...manifest, module, origModules: origMods }
        })
        return cfg
    }
    // , async start(opts, ctx){
    , releaseSingle(cfg){
        var {name, manifest, ...cfg0} = cfg
        // cfg0.mode = "production"
        var compiler = Webpack(cfg0)
        console.log('start to compile '+ name)
        return new Promise((resolve, reject) => {
            compiler.run((err, stats) => {
                if (stats) console.log(JSON.stringify(stats.toJson({ all: false, warnings: true, errors: true })))
                compiler.close((closeErr) => {
                    var error = err || closeErr || (stats?.hasErrors() && new Error(name + ' compilation failed'))
                    if (error) return reject(error)
                    console.log(name, 'compiled successfully')
                    resolve()
                });
            })
        })
    }
    , start(cfg, version, dev, servers) {
        var { name, manifest,  ...cfg0 } = cfg
        var { port, open, public } = dev
        var compiler = Webpack(cfg0)
        var devServerOptions = {
            port, open: dev.reloading ? false : open
            , hot: false
            , liveReload: true
            , ...cfg0.devServer
            // static is v4 option
            , static: {
                ...cfg0.devServer?.static
                , directory: public
            }
            // , contentBase: public
            , headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
                "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization"
            }

        }
        if (dev.reloading) devServerOptions.open = false

        var compiled = false
        compiler.hooks.done.tap('UiuxLiveReload', (stats) => {
            if (stats.hasErrors()) return
            var notify = compiled || servers[port].reloadAfterCompile
            compiled = true
            servers[port].reloadAfterCompile = false
            if (!notify) return
            // Federated consumers have their own websocket, not the remote's.
            setImmediate(() => {
                for (var id in servers) {
                    var target = servers[id].server
                    if (target?.options.liveReload && target.webSocketServer) {
                        target.sendMessage(target.webSocketServer.clients, 'static-changed', name)
                    }
                }
            })
        })

        if(open){
            devServerOptions.setupMiddlewares = (middlewares, svr) => {
                svr.app.use(function(req, res, next) {
                    res.header("Access-Control-Allow-Origin", "*")
                    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
                    // res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
                    next();
                });
                svr.app.get('/_/action/:type/:id',async (req, res) => {
                    var { params: { id, type } } = req
                    if(!servers[id]){
                        console.log(id+' is not listening')
                        return res.status(404).send({x:'server not found'})
                    }
                    return queueServerOperation(servers[id], async () => {
                        console.log('-----------'+type+'--------------')
                        await servers[id].ready
                        var {version, server: sv, dir, dev} = servers[id]
                        var cfg = getCfg(dir)
                        if(!cfg){
                            return res.status(500).send({x:'cfg error'})
                        }
                        var {name} = cfg
                        if(type === 'stop' || type === 'restart'){
                            var m1 = `Stopping ${name}@${version} at port ${id}`
                            var m2 = `Terminated ${name}@${version} at port ${id}`
                            var running = !!sv.server
                            if(running){ //stop, restart
                                console.log(m1)
                                await sv.stop()
                                console.log(m2)
                            }
                            if(type === 'stop'){
                                return res.send(running? m2: m1)
                            }
                        }
                        if(type === 'start' || type === 'restart'){
                            var m3 = `Starting ${name}@${version} at port ${id}`
                            var m4 = `Running ${name}@${version} at port ${id}`
                            var stopped = !sv.server
                            if(stopped){ //stop, restart
                                console.log(m3)
                                servers[id].reloadAfterCompile = true
                                cmd.start(cfg, version, { ...dev, reloading: true }, servers )
                                await servers[id].ready
                                console.log(m4)
                            }
                            return res.send(stopped? m4: m3)
                        }
                        return res.status(400).send({x:'unknown action'})
                    }).catch(error => {
                        console.error(`Server action ${type} failed on ${id}:`, error)
                        res.status(500).send({x: error.message})
                    })
                });
                return middlewares
            }
        }
           
            //v4 compiler is the last args
        var server = new DevServ(devServerOptions, compiler)
        // await server.start()
        //v4 uses start
        // .then(x=>{
        servers[port].ready = server.start().then(() => logStart(name, version, port))
        servers[port].ready.catch(error => console.error(`Failed to start ${name} on ${port}:`, error))
        // })
        // var server = new DevServ(compiler, devServerOptions)
        // server.listen(port, 'localhost', (x)=>{
        //     console.log(`${name}@${version} : ${port}`)
        // })
        servers[port].server = server
        servers[port].manifest = manifest
        return server
    }
    , build(cfg) {
        var { name, ...cfg0 } = cfg
        var compiler = Webpack(cfg0)
        compiler.run()
    }
    //TODO
    , getTag(base, domain, ver) {
        var str = fs.readFileSync(j(base, 'master/domain', domain + '.json'))
        //TODO exception
        var info = JSON.parse(str)
        var dists = info['dist-tags'] || {}
        dists[ver] = ver
        var tags = [], verDict = {}
        // var branch = info.branch || domain.split('/').join('_')// uiux/html
        var branch = domain.split('_').join('/')// uiux/html

        for (var i in dists) {
            var d = dists[i]
            if (!d) continue
            if (verDict[d] === undefined) {
                verDict[d] = tags.length
                tags.push({
                    tag: branch + '/' + d
                    , folder: branch + '/' + d
                    , dist: [i]
                })
            }
            else {
                tags[verDict[d]].dist.push(i)
            }
            // if(parts[1] === 'alpha'){
            //     folder = tag + '-' + info?.alpha?.[parts[0]] // 1.0.0-alpha-a1b2c3
            // }
            // else 
        }

        return tags
    }
    , cloneTag(base, repo, tag, f) {
        if (!f) f = tag
        //tag: uiux/engine/@1.0.0-alpha
        var folder = j(base, f)
        // folder exists, then exit
        if (fs.existsSync(folder)) {
            if (!updatedFolder[folder]) {
                runCmd(folder, `git fetch --tags -f`)
                runCmd(folder, `git checkout ${tag}`)
                updatedFolder[folder] = 1
            }
            return 0
        }
        console.log('Branch or tag ' + tag + ' does not exist, cloning it...')
        return runCmd(base, `git clone ${repo} ${folder} --branch=${tag}`)
    }
    , bareClone(base, repo, branches) {
        if (!fs.existsSync(j(base, '.bare'))) {
            runOrThrow(base, `git clone --bare ${repo} .bare`)
        }
        if (!fs.existsSync(j(base, '.git'))) {
            fs.writeFileSync(path.join(base, '.git'), 'gitdir: ./.bare')
        }
        if (typeof branches === 'string')
            branches = [branches]
        branches.forEach(x => {
            if (!fs.existsSync(j(base, x)))
                runOrThrow(base, `git worktree add ./${x} ${x}`)
        })
    }
}

var updatedFolder = {}
var domainPorts = {}
var used = {}
function random(min = 1, max = 1000) {
    var num = Math.floor(Math.random() * (max - min) + min)
    // console.log(num, min, max, used)
    if (used[num])
        num = random(min, max)
    else
        used[num] = 1
    // else return random(min, max)
    return num
}

function updateMaster(base, repo, pull) {
    var folder = j(base, 'master')
    var git = j(folder, '.git')
    if (fs.existsSync(folder) && fs.existsSync(git)) {
        if (pull) {
            console.log('master branch exists, updating it...')
            return runCmd(folder, `git pull`)
        }
    }
    return cmd.cloneTag(base, repo, 'master')
}

function setPort(domain, verList, port) {
    if (!domainPorts[domain])
        domainPorts[domain] = {}
    for (var ver of verList) {
        var v = ver.split('-')[0]
        if (!domainPorts[domain][v])
            domainPorts[domain][v] = port
    }

}

//git tag -l --points-at HEAD
var done = {}
function debugOne(dir, { base, repo, port, defPorts = {}, open = true }) {
    if (done[dir]) {
        console.log(`The dir ${dir} has been processed. exit...`)
        return
    }
    done[dir] = 1
    console.log('Processing ' + dir + '....')

    cmd.yarn(dir)
    var [deps, main] = cmd.getUiDeps(dir)

    //for each ui dependency
    for (var i in deps) {
        var tags = cmd.getTag(base, i, deps[i])
        for (var item of tags) {
            exitOrThrow(cmd.cloneTag(base, repo, item.tag, item.folder))
            var p1 = port
            if (port) {
                // domainPorts[i][dir] = port
                var ver0 = item.dist[0]
                var v = ver0.split('-')[0]
                var dp = defPorts[i]?.[v]
                p1 = dp || random(3000, 4000)
                setPort(i, item.dist, p1)
            }
            debugOne(j(base, item.folder), { base, repo, port: p1, defPorts, open: false })
        }

        // var tag =  branch + '-' +deps[i]
        // exitOrThrow(cmd.cloneTag(base, repo, tag, folder))

    }

    var cfg = cmd.prepare(dir, main, deps)
    var version = dir.split(path.sep).pop()
    if (port) {
        cmd.start(cfg, version, { port, open, public: j(dir, "public") })
    }
    else cmd.releaseSingle(cfg)

}



function readDebugDomains(dir) {
    var file = j(dir, 'public', 'domain.js')
    if(fs.existsSync(file)){
        var content = fs.readFileSync(file)
        return readDomainContent(content)
    }
    return []
}

function readDomainContent(content) {
    var lines = content.toString().split('\n')
    var ports = lines[1].substr('var port = '.length)
    var usingExt = lines[2].length > 0 
    var obj = JSON.parse(ports)
    return [obj, usingExt]
}
function writeDebugDomains(dir, ext) {
    
    var content = `
var port = ${JSON.stringify(domainPorts)}
`+ (ext?`port = Object.assign(port, ${JSON.stringify(ext)})
`:'')
+`if(!window.__URLS__){
    window.__URLS__ = {}

    for(var i in port){
        for(var j in port[i]){
            var url = 'http://localhost:'+port[i][j]
            window.__URLS__[i+'@'+j] = url
            if(j==='latest')
                window.__URLS__[i] = url
        }
    }
}`
    if(!fs.existsSync(j(dir, 'public')))
        fs.mkdirSync(j(dir, 'public'))
    fs.writeFileSync(j(dir, 'public', 'domain.js'), content)
}
function writeDebugHTML(dir, server, defPort, ext, servers) {
    var list = []
    var port = domainPorts
    var debugUrl = 'http://localhost:'+defPort+'/debug.html'

    var repoUrl = gitUrlToHttps(mapper.repoFn())


    var headerHtml = `
    <div class="tree-panel">
        <ul>
        <li>Repository: <a href="${repoUrl}" target="_blank">${repoUrl}</a></li>
        </ul>
    </div>
    `

    for (var i in port) {
        for (var k in port[i]) {
            var p = port[i][k]
            var {manifest: {origModules: module, name: domainName}, branch} = servers[p]
            var url = 'http://localhost:' + p
            var clist = [], branchUrl = getGitFileUrls(repoUrl, branch).branchUrl
            for(var m in module){
                var sourcePath = module[m]
                if (sourcePath[0] === '.' && !path.extname(sourcePath)) sourcePath += '.js'
                var urls = getGitFileUrls(repoUrl, branch, sourcePath)
                var blobUrl = urls.blobUrl
                if(module[m][0] !== '.') blobUrl = 'https://www.npmjs.com/package/'+ module[m]
                clist.push(`<li>${domainName+'://'+path.basename(m)} => <a href='${blobUrl}' target='_blank'>${branch}: ${module[m]}</a></li>`)
            }
            
            var componentList = clist.length
                ? `<ul class="components">` + clist.join('') + `</ul>`
                : '';
            var stopBtn = p === defPort ? '' :
                `<button class="btn stop" onclick="action(this, '${p}')" id='toggle_${p}' disabled>Stop</button>`
            var restartBtn =
                `<button class="btn restart" onclick="action(this, '${p}')" id='restart_${p}' disabled>Restart</button>`
            list.push(`
                <li class='service-item' id='_${p}'>
                <div class='info'>
                    <strong>${i}@${k}</strong>:
                    <a href='${url}' target='_blank'>${url}</a>  |
                    <a href='${url}/remoteEntry.js' port='${p}' target='_blank'>remoteEntry.js</a>  |
                    <a href='${branchUrl}'target='_blank'>source</a>

                    <span id="time_${p}" class="timestamp"></span>
                </div>
                <div class='actions'>
                    ${stopBtn}
                    ${restartBtn}
                </div>
                ${componentList}
                </li>
            `)
        }
    }
    

    var extstring = ext.map(x=>
        `<div>domains from <a href='http://localhost:${x}/domain.js'>http://localhost:${x}/</a></div><iframe
        src='http://localhost:${x}/debug.html' style="
        width: 100vw;
        height: 500px;
        border: none;
    "></iframe><br />\n`) || ''

    var templatePath = path.resolve(__dirname, 'debug.tmpl.html')
    var template = fs.readFileSync(templatePath, 'utf-8')

    var content = template
    .replace('{{HEADER_HTML}}', headerHtml)
    .replace('{{LIST_HTML}}', list.join('\n'))
    .replace('{{EXT_HTML}}', extstring)
    .replaceAll('{{DEF_PORT}}', defPort)

    fs.writeFileSync(j(dir, 'public', 'debug.html'), content)
    // debugger
    server.openBrowser(debugUrl)
}

//debug from release repo
function generalDebug({ dir, base, repo, port, pull }) {
    if (!fs.existsSync(base)) {
        fs.mkdirSync(base, { recursive: true })
    }
    exitOrThrow(updateMaster(base, repo, pull))
    var defPorts = readDebugDomains(dir)
    debugOne(
        dir
        , {
            repo
            , port
            , base
            , defPorts
        }
    )
    if(!defPorts) writeDebugDomains(dir)
}
var getCfg = (dir)=>{
    try {
        var [deps, main] = cmd.getUiDeps(dir)
        var cfg = cmd.prepare(dir, main, deps)
    }
    catch (e) {
        console.log(`dir ${dir} throws exception`, e)
        return
    }
    return cfg
}
function getBranchCfg(branch, base, repo, pull){
    console.log('>>>>> processing the branch', branch)
    var dir = j(base, branch)
    var curHash
    if (!fs.existsSync(dir))
        runOrThrow(base, `git clone ${repo} ${branch} --branch=${branch}`)
    else if (pull === 'all' || pull.split(',').includes(branch)) {//pull the new code every time.
        var ret = runCmd(dir, `git rev-parse --short HEAD`)
        if (!ret.code) {
            curHash = ret.stdout.trim()
        }
        ret = runCmd(dir, `git pull`)
        if (ret.code) {
            curHash = null
        }
    }

    cmd.yarn(dir, curHash)
    var cfg = getCfg(dir)
    return cfg

}
function findAPort(obj, port){
    if(!port){
        do{
            port = random(3000, 4000)
            obj[port] = 1
        }
        while(!obj[port])
    }
    if(!obj[port]) 
        obj[port] = 1
    return port
}

async function coreDebug({ dir: base, repo, branches, port, pull = '', excludes=[], use=[] }) {
    var server, servers = {}
    
    var pros = []
    for(var ep of use){ //external ports
        pros.push(new Promise((resolve, reject) =>{
            http.get('http://localhost:'+ep+'/domain.js', (res)=> {
                var rawData = ''
                res.on('data', chunk => {
                    rawData += chunk
                })
                
                res.on('end', () => {
                    if(rawData){
                        var d = readDomainContent(rawData)
                        resolve(d[0])
                    }
                    else resolve({})
                })
                
            })
        }))
    }
    var results = await Promise.all(pros)

    var start = branches[0]
    var pub = j(base, start)
    var [defPorts, usedExt] = readDebugDomains(pub)

    for(var i = 1; i < results.length; i++){
        for(var k in results[i]){
            results[0][k] = results[i][k]
        }
    }
    var white = branches.includes('+')
    // branches = branches.filter(item => item !== "+")
    if(white){
        //using uiDependencies
        white = {}
        var dir = j(base, branches[0])
        var [deps] = cmd.getUiDeps(dir)
        for(var i in deps){ 
            var branch = i.split('_').join('/')
            white[branch] = deps[i]
            branches.push(branch)
        }
    }

    var ver = 'latest'
    var exc = excludes.reduce((a,c)=>{
        a[c] = 1
        return a
    }, {})
    var portObj = {}
    for(var i in results[0]){
        portObj[results[0][i][ver]] = 1
    }
    branches.forEach((x, i) => {
        if(x === '+') return        

        if(exc[x]) return
        var cfg = getBranchCfg(x, base, repo, pull)
        if(!cfg) return

        var dir = j(base, x)
        var b = cfg.name //x.split('/').join('_')
        var p = !i ? port : findAPort(portObj, defPorts?.[b]?.[ver]) // (defPorts?.[b]?.[ver] || random(3000, 4000))
        setPort(b, [ver], p)
        var dev = { port: p, open: !i, public: j(dir , "public") }
        servers[p] = {dir, dev, version: ver, branch: x}
        var s = cmd.start(cfg, ver, dev , servers)
        servers[p].closeConfigWatcher = watchConfig(dir, () => queueServerOperation(servers[p], async () => {
            var entry = servers[p]
            var next = getCfg(dir)
            if (!next) throw new Error(`Invalid configuration in ${dir}; fix it and save again.`)
            if (next.name !== entry.manifest.name) {
                throw new Error('Changing the module name requires restarting uiux dev.')
            }
            var { name, manifest, ...options } = next
            Webpack.validate(options)
            Webpack.validateSchema(require('webpack-dev-server/lib/options.json'), next.devServer || {}, {
                name: 'Dev Server'
            })
            if (next.devServer?.port !== undefined && next.devServer.port !== p) {
                throw new Error('Changing the dev-server port requires restarting uiux dev.')
            }
            await entry.ready
            if (!entry.server.server?.listening) return
            console.log(`Configuration changed: rebuilding ${next.name} on ${p}`)
            await entry.server.stop()
            entry.reloadAfterCompile = true
            cmd.start(next, ver, { ...dev, reloading: true }, servers)
            await entry.ready
        }), error => console.error(`Configuration reload failed for ${dir}:`, error))
        if(!server) {server = s}
    })
    if(!defPorts || pros.length > 0 || (usedExt && pros.length === 0)){
        writeDebugDomains(pub, results?.[0])
        for(var i in servers){
            var svr = servers[i]
            writeDebugDomains(svr.dir, results?.[0])
        }
    }
    writeDebugHTML(pub, server, port, use, servers)

}
async function releaseOne(opt){
    if (opt.out && opt.target) throw new Error('Use either --out or --target, not both.')
    if (opt.serve && opt.branches?.length && !opt.out && !opt.target) {
        throw new Error('--serve with multiple branches requires --out or --target.')
    }
    if(opt.out || opt.target || opt.branches?.length){
        return coreAllRelease(opt)
    }
    var {mode, dir} = opt
    cmd.yarn(dir)
    var cfg = getCfg(dir)
    if(!cfg) {
        console.log('configuration is not generated')
        return
    }
    if (mode) cfg.mode = ['dev', 'develop', 'development'].includes(mode.toLowerCase()) ? 'development' : 'production'
    await cmd.releaseSingle(cfg)
    if(opt.serve)
        serveStatic(cfg.output.path, opt.serve)
}
// Build several branches into one output root, using the directory structure
// as the cross-module reference (the dev command uses ports instead).
// Every branch is emitted to `out/<branch>`, and the root gets a domain.js
// (module name -> /<branch>), an aggregated ref.js, a manifest.json listing
// every site and an index.html navigation hub.
async function coreAllRelease(opt){
    var base = opt.base || opt.dir
    var repo = opt.repo
    var pull = opt.pull || ''
    var mode = opt.mode
    var out = opt.out || opt.target
    var excludes = opt.excludes || []
    var branches = (opt.branches && opt.branches.length)
        ? opt.branches.slice()
        : mapper.branchesFn(opt.remote || 'origin', opt.start || '.')

    var outRoot = out && (path.isAbsolute(out) ? out : opt.target ? path.resolve(opt.target) : j(base, out))
    if(outRoot && !fs.existsSync(outRoot))
        fs.mkdirSync(outRoot, { recursive: true })

    var exc = excludes.reduce((a, c) => { a[c] = 1; return a }, {})

    if(branches.includes('+')){
        // pull extra branches from the start branch uiDependencies
        var dir0 = j(base, branches[0])
        var [deps] = cmd.getUiDeps(dir0)
        for(var k in deps)
            branches.push(k.split('_').join('/'))
    }

    branches = [...new Set(branches)]
    var built = []
    for(var i = 0; i < branches.length; i++){
        var x = branches[i]
        if(x === '+' || exc[x]) continue
        var cfg = getBranchCfg(x, base, repo, pull)
        if(!cfg) continue
        if (mode) cfg.mode = ['dev', 'develop', 'development'].includes(mode.toLowerCase()) ? 'development' : 'production'
        var outDir = outRoot ? j(outRoot, x) : cfg.output.path
        cfg.output = { ...cfg.output, path: outDir }
        built.push({ name: cfg.name, branch: x, outDir, src: j(base, x), pkg: readPkg(j(base, x)) })
        await cmd.releaseSingle(cfg)
    }

    if (opt.out) {
        writeReleaseRefs(outRoot, built)
        writeReleaseManifest(outRoot, built)
        writeReleaseIndex(outRoot)
    }
    console.log('\nAll branches released' + (outRoot ? ' under ' + outRoot : ''))
    if(opt.serve && outRoot)
        serveStatic(outRoot, opt.serve)
}
function readPkg(dir){
    try{
        var p = j(dir, 'package.json')
        delete require.cache[require.resolve(p)]
        return require(p)
    }
    catch(e){ return {} }
}
// Write the cross-module reference at the output root. Every branch's built
// index.html loads the absolute /domain.js and /ref.js, so the references live
// at the root: domain.js maps each module name to its absolute /<branch> dir
// (the loader appends /remoteEntry.js), and ref.js aggregates the external
// template URLs each branch ships in its own public/ref.js.
function writeReleaseRefs(outRoot, built){
    if(!built.length) return
    var ref = {}
    built.forEach(b => {
        var url = '/' + b.branch
        ref[b.name] = url
        ref[b.name + '@latest'] = url
    })
    var domain = `
window.__URLS__ = window.__URLS__ || {}
;(function(){
  var ref = ${JSON.stringify(ref, null, 2)}
  for(var k in ref){ window.__URLS__[k] = ref[k] }
})()
`
    fs.writeFileSync(j(outRoot, 'domain.js'), domain)
    console.log('Wrote domain.js to ' + j(outRoot, 'domain.js'))

    var seen = {}, parts = []
    built.forEach(b => {
        var f = j(b.src, 'public', 'ref.js')
        if(!fs.existsSync(f)) return
        var body = fs.readFileSync(f).toString().trim()
        // dedupe by content: every branch usually ships the same external
        // template URLs, so identical ref.js files are merged into one block
        if(!body || seen[body]) return
        seen[body] = 1
        parts.push('/* ' + b.branch + ' */\n' + body)
    })
    var refJs = parts.length ? parts.join('\n') : ''
    if(refJs){
        fs.writeFileSync(j(outRoot, 'ref.js'), refJs)
        console.log('Wrote ref.js to ' + j(outRoot, 'ref.js'))
    }

    // keep every branch folder's domain.js/ref.js identical to the root ones,
    // so each folder is self-consistent with the external references
    built.forEach(b => {
        fs.writeFileSync(j(b.outDir, 'domain.js'), domain)
        if(refJs) fs.writeFileSync(j(b.outDir, 'ref.js'), refJs)
    })
}
// Write a manifest.json describing every released site, following the
// playground sites/manifest.json shape.
function writeReleaseManifest(outRoot, built){
    var manifest = {
        title: 'UIUX Sites'
        , description: 'Site navigation hub for the released branches.'
        , sites: built.map(b => ({
            id: b.name
            , name: b.pkg.name || b.name
            , description: b.pkg.description || ''
            , version: b.pkg.version || ''
            , path: b.branch + '/'
            , tags: []
        }))
    }
    fs.writeFileSync(j(outRoot, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log('Wrote manifest.json to ' + j(outRoot, 'manifest.json'))
}
// Write the navigation hub index.html at the output root. It fetches
// manifest.json and renders a card per released site.
function writeReleaseIndex(outRoot){
    var html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Site Navigation</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f6f8; color: #1f2328; }
    header { padding: 48px 24px 24px; max-width: 960px; margin: 0 auto; }
    header h1 { margin: 0 0 8px; font-size: 28px; }
    header p { margin: 0; color: #57606a; }
    main { max-width: 960px; margin: 0 auto; padding: 16px 24px 64px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 20px; }
    .card { display: flex; flex-direction: column; background: #fff; border: 1px solid #d0d7de; border-radius: 12px; padding: 20px; text-decoration: none; color: inherit; transition: box-shadow .15s ease, transform .15s ease; }
    .card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.08); transform: translateY(-2px); }
    .card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .card-head img { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }
    .card h2 { margin: 0; font-size: 18px; }
    .card p { margin: 0; color: #57606a; font-size: 14px; line-height: 1.5; }
    .tags { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { font-size: 12px; background: #eaeef2; color: #57606a; border-radius: 999px; padding: 2px 10px; }
    .empty { color: #57606a; }
  </style>
</head>
<body>
  <header>
    <h1 id="title">Site Navigation</h1>
    <p id="subtitle"></p>
  </header>
  <main>
    <div id="grid" class="grid"></div>
  </main>
  <script>
    fetch('manifest.json')
      .then(function (r) { return r.json(); })
      .then(function (m) {
        document.getElementById('title').textContent = m.title || 'Site Navigation';
        document.getElementById('subtitle').textContent = m.description || '';
        var grid = document.getElementById('grid');
        var sites = (m.sites || []);
        if (!sites.length) { grid.innerHTML = '<p class="empty">No sites available.</p>'; return; }
        sites.forEach(function (s) {
          var a = document.createElement('a');
          a.className = 'card';
          a.href = s.path;
          var thumb = s.thumbnail ? '<img src="' + s.thumbnail + '" alt="" />' : '';
          var tags = (s.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');
          a.innerHTML = '<div class="card-head">' + thumb + '<h2></h2></div>' + '<p class="desc"></p>' + (tags ? '<div class="tags">' + tags + '</div>' : '');
          a.querySelector('h2').textContent = s.name || s.id;
          a.querySelector('.desc').textContent = s.description || '';
          grid.appendChild(a);
        });
      })
      .catch(function () { document.getElementById('grid').innerHTML = '<p class="empty">Failed to load site manifest.</p>'; });
  </script>
</body>
</html>
`
    fs.writeFileSync(j(outRoot, 'index.html'), html)
    console.log('Wrote index.html to ' + j(outRoot, 'index.html'))
}
// Serve a build output directory over http so the release can be verified in a
// browser. Plain static file server: the directory is the web root, so the
// absolute /domain.js, /ref.js and /<branch> references resolve as deployed.
var MIME = {
    '.html': 'text/html; charset=utf-8'
    , '.js': 'text/javascript; charset=utf-8'
    , '.mjs': 'text/javascript; charset=utf-8'
    , '.css': 'text/css; charset=utf-8'
    , '.json': 'application/json; charset=utf-8'
    , '.map': 'application/json; charset=utf-8'
    , '.svg': 'image/svg+xml'
    , '.png': 'image/png'
    , '.jpg': 'image/jpeg'
    , '.jpeg': 'image/jpeg'
    , '.gif': 'image/gif'
    , '.webp': 'image/webp'
    , '.ico': 'image/x-icon'
    , '.wasm': 'application/wasm'
    , '.woff': 'font/woff'
    , '.woff2': 'font/woff2'
    , '.ttf': 'font/ttf'
    , '.txt': 'text/plain; charset=utf-8'
    , '.pdf': 'application/pdf'
}
function serveStatic(root, port){
    port = parseInt(port, 10) || 8080
    if(!fs.existsSync(root)){
        console.log('The directory to serve does not exist: ' + root)
        return
    }

    var server = http.createServer((req, res) => {
        var urlPath = decodeURIComponent(req.url.split('?')[0])
        var rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
        var file = j(root, rel)
        // keep the request inside the served root
        if(path.relative(root, file).startsWith('..')){
            res.statusCode = 403
            return res.end('Forbidden')
        }
        fs.stat(file, (err, stat) => {
            if(!err && stat.isDirectory()){
                file = j(file, 'index.html')
            }
            fs.readFile(file, (e, data) => {
                if(e){
                    res.statusCode = 404
                    return res.end('Not found: ' + urlPath)
                }
                res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
                res.setHeader('Access-Control-Allow-Origin', '*')
                res.end(data)
            })
        })
    })
    server.listen(port, () => {
        console.log('\nServing ' + root)
        console.log('  http://localhost:' + port + '/')
    })
    return server
}

module.exports = {
    generalDebug
    , coreDebug
    , releaseOne
}