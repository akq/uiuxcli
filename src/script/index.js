var build = require('./build')
var runTest = require('uiuxtest')
// var runPreviewer = require('uiuxpreviewer')

module.exports = {
    ...build
    , runTest
    , runPreviewer: ()=>console.log('todo')
}