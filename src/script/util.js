var shell = require('shelljs');
var path = require('path')

function runCmd(dir, cmd) {
    shell.cd(dir)
    var res = shell.exec(cmd)
    return res
}
var j = path.join
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

module.exports = {
    runCmd
    , j
    , exitOrThrow
    , runOrThrow
}