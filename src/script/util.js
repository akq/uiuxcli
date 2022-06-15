var shell = require('shelljs')

function runCmd(dir, cmd) {
    shell.cd(dir)
    var res = shell.exec(cmd)
    return res
}

function exitOrThrow(exit){
    if(exit.code){
        throw {
            code:exit.code
            , msg: exit.stderr
        }
    }
    return exit
    // console.log('')
}
function runOrThrow(dir, cmd){
    exitOrThrow(runCmd(dir, cmd))
}
var cwd = process.cwd()
var mapper = {
    repoFn : (remote = 'origin') => {
        var ret = runCmd(cwd, 'git remote get-url '+remote)
        if(ret.code){
            return
        }
        else return ret.stdout.trim()
    }
    , branchesFn : (remote = 'origin', starter= 'master' ) => {
        var ret = runCmd(cwd, 'git branch -r')
        if(ret.code){
            return [starter]
        }
        // var prefix = 'remotes/'+remote
        var prefix = remote
        var len = prefix.length +1
        var out = ret.stdout.trim().split('\n')
        var list = out.filter(x=>{
            x = x.trim() 
            return x.startsWith(prefix) 
            && ! x.startsWith(prefix + '/HEAD')
            && ! x.startsWith(prefix + '/!')
            && x !== prefix + '/main' 
            && x !== prefix + '/master' 
            && x !== prefix + '/' + starter
        }).map(x=>x.trim().substr(len))
        list.unshift(starter)
        return list
    }
    , currentBranch: ()=>{
        var ret = runCmd(cwd, 'git branch --show-current')
        if(ret.code){
            return 'master'
        }
        return ret.stdout.trim()
    }
    , currentRemote: () => {
        var ret = runCmd(cwd, 'git remote')
        if(ret.code){
            throw ret.code
        }
        var out = ret.stdout.trim().split('\n')
        return out.includes('origin')?'origin': out[0]
    }
    , csv2arr:(str)=>str.split(',')
}
module.exports = {
    runCmd
    , exitOrThrow
    , runOrThrow
    , mapper
}