var { runOrThrow, mapper: { currentBranch } } = require("./helper")

var OP = {
    add(name, dir){
        console.log('fetch the first commit hash:')
        var ret = runOrThrow(dir, `git rev-list HEAD | tail -n 1`)
        var hash = ret.stdout.trim()
        if(hash){
            var cb = currentBranch()
            console.log('checking out a new branch')
            runOrThrow(dir, `git checkout -b "${name}" "${hash}"`)

            console.log('pushing local branch to the remote')
            runOrThrow(dir, `git push -u origin "${name}"`)

            console.log('switch back to the working branch')
            runOrThrow(dir, `git checkout "${cb}"`)
        }
        //"git" checkout -b "x/styled" "c9dccfe186c17f33fccd9b5e7a2d4cbed7e01aae"
    }
}
module.exports = (obj) => {
    var {dir, ...actions} = obj
    for (var act in actions){
        OP[act](actions[act], dir)
        break
    }
}