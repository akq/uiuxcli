var path = require('path')

var exp = {}
var ctx = (n) => path.join(__dirname, '../../node_modules', n)
exp.css = (opt) => ({
    test: /\.css$/i,
    use: [ctx("style-loader"), ctx("css-loader")],
})

module.exports = exp