var build = require('./build')
var projCrud = require('./project')
var runTest = require('uiuxtest')
var pkg = require('../../package.json')
// var runPreviewer = require('uiuxpreviewer')

module.exports = {
    ...build
    , runTest
    , projCrud
    , runPreviewer: () => console.log('todo')
    , getVersion: () => console.log(pkg.version)
}