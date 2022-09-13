var Webpack = require('webpack')
var DevServ = require('webpack-dev-server')
var createCfg = require('../config/tmpl.config')
var path = require('path')
var fs = require('fs')

var {
    runCmd
    , exitOrThrow
    , runOrThrow
} = require('./helper')

// var { Worker } = require("worker_threads");

// //Create new worker
// var worker = new Worker("./worker.js");
// worker.on("message", result => {

// });


var j = path.join
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
            var pkg = require(j(dir, './package.json'))
            return [pkg.uiDependencies, pkg.main]
        }
        catch (e) {
            throw {
                msg: 'package.json is not found in the folder: ' + dir
            }
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
            , manifest: { main, lock: deps, ...manifest, module }
        })
        return cfg
    }
    // , async start(opts, ctx){
    , releaseSingle(cfg){
        var {name, ...cfg0} = cfg
        // cfg0.mode = "production"
        var compiler = Webpack(cfg0)
        console.log('start to compile '+ name)
        compiler.run((err, stats) => {
            if (err) {
                console.log(JSON.stringify(err))
            }
            console.log( JSON.stringify(stats.toJson({ all: false, warnings: true, errors: true })))
            compiler.close((closeErr) => {
                if(closeErr)
                    console.log(name, 'compiled with error', closeErr)
                else{
                    console.log(name, 'compiled successfully')
                }
            });
        })
    }
    , start(cfg, version, dev, servers) {
        var { name, ...cfg0 } = cfg
        var { port, open, public } = dev
        var compiler = Webpack(cfg0)
        var devServerOptions = {
            port, open
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
                    console.log('-----------'+type+'--------------')
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
                            // await sv.start()
                            cmd.start(cfg, version, dev, servers )
                            console.log(m4)
                            logStart(name, version, id)
                        }
                        return res.send(stopped? m4: m3)
                    }

                });
                return middlewares
            }
        }
           
            //v4 compiler is the last args
        var server = new DevServ(devServerOptions, compiler)
        // await server.start()
        //v4 uses start
        // .then(x=>{
        server.start().then(x=>logStart(name, version, port))
        // })
        // var server = new DevServ(compiler, devServerOptions)
        // server.listen(port, 'localhost', (x)=>{
        //     console.log(`${name}@${version} : ${port}`)
        // })
        servers[port].server = server
        return server
    }
    , build(cfg) {
        var { name, ...cfg0 } = cfg
        var compiler = Webpack(cfg0)
        compiler.run()
    }
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
    if (!used[num])
        used[num] = 1
    else return random(min, max)
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
        var lines = content.toString().split('\n')
        var ports = lines[1].substr('var port = '.length)
        var obj = JSON.parse(ports)
        return obj
    }
}
function writeDebugDomains(dir) {
    var content = `
var port = ${JSON.stringify(domainPorts)}

if(!window.__URLS__){
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
    fs.writeFileSync(j(dir, 'public', 'domain.js'), content)
}
function writeDebugHTML(dir, server, defPort) {
    var list = []
    var port = domainPorts
    var debugUrl = 'http://localhost:'+defPort+'/debug.html'
    for(var i in port){
        for(var k in port[i]){
            var p = port[i][k]
            var url = 'http://localhost:'+ p
            var stopBtn = p === defPort ? '': `<button onclick="action(this, '${p}')" id='toggle_${p}' disabled>stop</button>`
            list.push(`<li style='color: green;'  id='_${p}'>${i}@${k}:<a href='${url}/remoteEntry.js' port='${p}'>${url}</a> ${stopBtn} <button onclick="action(this, '${p}')" id='restart_${p}' disabled>restart</button></li>`)
        }
    }

    var content = `<html>    <head><script>
    function stop(id){
        document.querySelector('#_'+id).style.color='red'
        var tg = document.querySelector('#toggle_'+id)
        if(tg){ 
            tg.textContent  = 'start'
            tg.disabled = false
        }
        document.querySelector('#restart_'+id).disabled = true
    }    
    function start(id){
        document.querySelector('#_'+id).style.color='green'
        var tg = document.querySelector('#toggle_'+id)
        if(tg) {
            tg.textContent  = 'stop'
            tg.disabled = false
        }
        document.querySelector('#restart_'+id).disabled = false
    }    
    function action(btn, id){
        var type = btn.textContent
        btn.disabled = true
        
        var pro = fetch('http://localhost:${defPort}/_/action/'+type+'/'+id);
        if(id===${defPort}){
            setTimeout(x=>window.close(), 1000)
        }
        else
            pro.then(x=>{
                switch(type){
                    case 'stop':
                        stop(id)
                    break
                case 'start':
                    fetch('http://localhost:'+id+'/remoteEntry.js').then(x=>{
                        start(id)
                    })
                    .catch(x=> alert('can\\'t start port '+id))
                    .finally(x=> btn.disabled = false)
                    break
                case 'restart': 
                    document.querySelector('#toggle_'+id).disabled  = true
                    fetch('http://localhost:'+id+'/remoteEntry.js')
                    .catch(x=> alert('can\\'t restart port '+id))
                    .finally(x=>{
                        document.querySelector('#toggle_'+id).disabled  = false
                        btn.disabled = false
                    })
                }
            }).finally(x=>{
                if(type==='stop') btn.disabled = false
            })
    }
    </script></head><body>
        <ul>
            ${list.join('\n')}
        </ul>
        <script>
        var links = document.querySelectorAll('li > a')
        for(let a of links){
            fetch(a.href).then(x=>{
                var tg = document.querySelector('#toggle_' + a.port)
                if(tg) tg.disabled  = false
                start(a.port)
            }).catch(x=>{
                stop(a.port)
            })
        }
        </script>
        </body></html>`
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
function coreDebug({ dir: base, repo, branches, port, pull = '' }) {
    var server, servers = {}
    var pub = j(base, branches[0])
    var defPorts = readDebugDomains(pub)
    var ver = 'latest'
    branches.forEach((x, i) => {
        
        var cfg = getBranchCfg(x, base, repo, pull)
        if(!cfg) return

        var dir = j(base, x)
        var b = x.split('/').join('_')
        var p = !i ? port : (defPorts?.[b]?.[ver] || random(3000, 4000))
        setPort(b, [ver], p)
        var dev = { port: p, open: !i, public: j(dir , "public") }
        servers[p] = {dir, dev, version: ver}
        var s = cmd.start(cfg, ver, dev , servers)
        if(!server) {server = s}
    })
    if(!defPorts)writeDebugDomains(pub)
    writeDebugHTML(pub, server, port)

}
function releaseOne({mode, dir}){
    cmd.yarn(dir)
    var cfg = getCfg(dir)
    if(!cfg) {
        console.log('configuration is not generated')
        return
    }
    if(mode) 
        cfg.mode = 'production'
    cmd.releaseSingle(cfg)
}
function coreAllRelease({ dir: base, repo, branches, port, pull = '' }) {
    branches.forEach((x, i) => {
        var cfg = getBranchCfg(x, base, repo, pull)
        if(!cfg) return
        cmd.releaseSingle(cfg)
    })
    // var pub = j(base, branches[0])
    // writeDebugDomains(pub)
}

module.exports = {
    generalDebug
    , coreDebug
    , releaseOne
}