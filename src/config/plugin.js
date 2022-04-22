var CopyPlugin = require('copy-webpack-plugin');
var HtmlWebpackPlugin = require('html-webpack-plugin');
var path = require('path');
var exp = {}
exp.html = (opt) => new HtmlWebpackPlugin({
    template: path.join(opt.dir, opt?.config?.html || "./public/index.html"),
})
exp.copy = () => new CopyPlugin({
    patterns: [
        {
            from: "public",
            globOptions: {
                ignore: ["**/index.html"],
            },
            noErrorOnMissing: true,
        },
    ],
})

module.exports = exp