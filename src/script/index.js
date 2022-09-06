var build = require('./build')
var projCrud = require('./project')
var runTest = require('uiuxtest')
// var runPreviewer = require('uiuxpreviewer')

module.exports = {
    ...build
    , runTest
    , projCrud
    , runPreviewer: () => console.log('todo')
}