var path = require('path')

var exp = {}
var ctx = (n) => path.join(__dirname, '../../node_modules', n)
exp.css = (opt) => ({
    test: /\.css$/i,
    use: [ctx("style-loader"), ctx("css-loader")],
})
exp.less = (opt) => ({
    test: /\.less/i,
    use: [ctx("style-loader"), ctx("css-loader"), ctx('less-loader')]
})
exp.scss = (opt) => ({
    test: /\.scss/i,
    use: [ctx("style-loader"), ctx("css-loader"), ctx('sass-loader')]
})

module.exports = exp