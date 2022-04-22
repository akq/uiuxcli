var Webpack = require('webpack')
var DevServ = require('webpack-dev-server')
var createCfg = require('../config/tmpl.config')
var path = require('path')
var fs = require('fs')
var {
    runCmd
    , j
    , exitOrThrow
    , runOrThrow
} = require('./util')

var cmd = {
    yarn(dir){
        if(!fs.existsSync(j(dir, 'package.json'))){
            console.log('no package.json found, will not run yarn command.')
            return 0
        }
        if(fs.existsSync(j(dir, 'yarn.lock')) && fs.existsSync(j(dir, 'node_modules'))){
            console.log('packages are already installed.')
            return 0
        }
        console.log('running yarn...')
        exitOrThrow(runCmd(dir, `yarn`))

    }
    , getUiDeps(dir){
        try{
            var pkg = require(j(dir, './package.json'))
            return [pkg.uiDependencies, pkg.main]
        } 
        catch(e){
            throw {
                msg: 'package.json is not found in the folder: '+ dir
            }
        }
    }
    , prepare(dir, main, deps){
        var manifest = require(j(dir, './manifest'))
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
    , start(cfg, version, dev){
        var {name, ...cfg0} = cfg
        var {port, open, public} = dev
        var compiler = Webpack(cfg0)
        var devServerOptions = { port, open
            , ...cfg0.devServer
            // static is v4 option
            , static:{
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
        //v4 compiler is the last args
        var server = new DevServ(devServerOptions, compiler)
        // console.log(`Starting debug server for the domain: ${name} at port: ${port}`)
        
        // await server.start()
        //v4 uses start
        server.start().then(x=>{
            console.log(`${name}@${version} : ${port}`)
        })
        // var server = new DevServ(compiler, devServerOptions)
        // server.listen(port, 'localhost', (x)=>{
        //     console.log(`${name}@${version} : ${port}`)
        // })
    }
    , build(cfg){
        var {name, ...cfg0} = cfg
        var compiler = Webpack(cfg0)
        compiler.run()
    }
    , getTag(base, domain, ver){
        var str = fs.readFileSync(j(base, 'master/domain', domain+'.json'))
        //TODO exception
        var info = JSON.parse(str)
        var dists = info['dist-tags'] || {}
        dists[ver] = ver
        var tags = [], verDict = {}
        // var branch = info.branch || domain.split('/').join('_')// uiux/html
        var branch = domain.split('_').join('/')// uiux/html

        for(var i in dists){
            var d = dists[i]
            if(!d) continue
            if(verDict[d]===undefined){
                verDict[d] = tags.length
                tags.push({
                    tag: branch + '/' + d
                    , folder: branch + '/' + d
                    , dist: [i]
                })
            }
            else{
                tags[verDict[d]].dist.push(i)
            }
                // if(parts[1] === 'alpha'){
                //     folder = tag + '-' + info?.alpha?.[parts[0]] // 1.0.0-alpha-a1b2c3
                // }
                // else 
        }

        return tags
    }
    , cloneTag(base, repo, tag, f){
        if(!f) f = tag
        //tag: uiux/engine/@1.0.0-alpha
        var folder = j(base, f)
        // folder exists, then exit
        if(fs.existsSync(folder)){
            if(!updatedFolder[folder]){
                runCmd(folder, `git fetch --tags -f`)
                runCmd(folder, `git checkout ${tag}`)
                updatedFolder[folder] = 1
            }
            return 0
        }
        console.log('Branch or tag '+tag+' does not exist, cloning it...')
        return runCmd(base, `git clone ${repo} ${folder} --branch=${tag}`)
    }
    , bareClone(base, repo, branches){
        if(!fs.existsSync(j(base, '.bare'))){
            runOrThrow(base, `git clone --bare ${repo} .bare`)
        }
        if(!fs.existsSync(j(base, '.git'))){
            fs.writeFileSync(path.join(base, '.git'), 'gitdir: ./.bare')
        }
        if(typeof branches === 'string')
            branches = [branches]
        branches.forEach(x=>{
            if(!fs.existsSync(j(base, x)))
                runOrThrow(base, `git worktree add ./${x} ${x}`)
        })
    }
}

var updatedFolder = {}
var domainPorts = {}
var used = {}
function random(min = 1, max = 1000) {
    var num = Math.floor(Math.random() * (max - min) + min)
    if(!used[num]) 
        used[num] = 1
    else return random(min, max)
    return num
}
function updateMaster(dir, base, repo){
    var folder = j(base, 'master')
    var git = j(folder, '.git')
    if(fs.existsSync(folder) && fs.existsSync(git)){
        console.log('master branch exists, updating it...')
        return runCmd(folder, `git pull`)
    }
    return cmd.cloneTag(base, repo, 'master')
}

function setPort(domain, verList, port){
    if(!domainPorts[domain])
        domainPorts[domain] = {}
    for(var ver of verList){
        var v = ver.split('-')[0]
        if(!domainPorts[domain][v])
            domainPorts[domain][v] = port
    }

}

//git tag -l --points-at HEAD
var done = {}
function debugOne(dir, {base, repo, port, open = true}){
    if(done[dir]){
        console.log(`The dir ${dir} has been processed. exit...`)
        return
    }
    done[dir] = 1
    console.log('Processing '+dir + '....')

    cmd.yarn(dir)
    var [deps, main] = cmd.getUiDeps(dir)

    //for each ui dependency
    for(var i in deps){  
        var tags = cmd.getTag(base, i, deps[i])
        for(var item of tags){
            exitOrThrow(cmd.cloneTag(base, repo, item.tag, item.folder))
            var p1 = port
            if(port){
                // domainPorts[i][dir] = port
                p1 = random(3000,4000)
                setPort(i, item.dist, p1)
            }
            debugOne(j(base, item.folder), {base, repo, port:p1, open:false})
        }

        // var tag =  branch + '-' +deps[i]
        // exitOrThrow(cmd.cloneTag(base, repo, tag, folder))

    }

    var cfg = cmd.prepare(dir, main, deps)
    var version = dir.split(path.sep).pop()
    if(port){
        cmd.start(cfg, version, {port, open, public: j(dir, "public")})
    }
    else cmd.build(cfg)

}


function writeDebugDomains(dir){
    var content = `
var port = ${JSON.stringify(domainPorts)}

if(!window.__URLS__){
    window.__URLS__ = {}

    for(var i in port){
        // if(!window.__URLS__[i]) window.__URLS__[i] = {}
        for(var j in port[i]){
            var url = 'http://localhost:'+port[i][j]
            window.__URLS__[i+'@'+j] = url
            if(j==='latest')
                window.__URLS__[i] = url
            // window.__URLS__[i][j] = 'http://localhost:'+port[i][j]
        }
    }
}`
    fs.writeFileSync(j(dir, 'public', 'domain.js'), content)
}
function generalDebug({dir, base, repo, port}){
    if(!fs.existsSync(base)){
        fs.mkdirSync(base, {recursive: true})
    }
    exitOrThrow(updateMaster(dir, base, repo))
    debugOne(
        dir
        , {
            repo
            , port
            , base
        }
    )
    writeDebugDomains(dir)
    
}

function coreDebug({dir: base, repo, branches, port, pull}){
    branches.forEach((x, i)=>{
        var dir = j(base, x)
        if(!fs.existsSync(dir))
            runOrThrow(base, `git clone ${repo} ${x} --branch=${x}`)
        else if(pull){//pull the new code every time.
            runOrThrow(dir, `git pull`)
        }
        
        cmd.yarn(dir)
        var [deps, main] = cmd.getUiDeps(dir)
        var cfg = cmd.prepare(dir, main, deps)
        var p = !i? port: random(3000,4000)
        setPort(x.split('/').join('_'), ['latest'], p)
        cmd.start(cfg, 'latest', {port: p, open:!i, public: j(dir, "public")})
    }) 
    writeDebugDomains(j(base, branches[0]))

}

module.exports = {
    generalDebug
    , coreDebug
}