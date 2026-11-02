var CopyPlugin = require('copy-webpack-plugin');
var HtmlWebpackPlugin = require('html-webpack-plugin');
var path = require('path');
var exp = {}
exp.html = (opt) => new HtmlWebpackPlugin({
    template: path.join(opt.dir, opt?.config?.html || "./public/index.html"),
})
exp.copy = (opt) => new CopyPlugin({
    patterns: [
        {
            from: path.join(opt.dir, "public"),
            to: ".",
            globOptions: {
                ignore: ["**/index.html"],
            },
            noErrorOnMissing: true,
        },
    ],
})

module.exports = exp