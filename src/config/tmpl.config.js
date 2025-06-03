var path = require('path')
var UiuxLoaderPlugin = require("uiuxloader")
var pluginFn = require('./plugin')
var ruleFn = require('./rule')
var use = require.resolve
module.exports = (opt) => {
  var {
    dir, manifest
  } = opt
  var {config, main, ...rest} = manifest
  var {plugin, rule, dev, dist = 'dist', publicPath, shared=['react', 'react-dom']} = config
  var plugins = plugin?.map(x=>{
    if(typeof x === 'string') return pluginFn[x]?.(opt)
    if(Array.isArray(x)){
      var fn = x.shift()
      return pluginFn[fn]?.(...x)
    }
  }) || []
  var rules = rule?.map(x=> {
    if(typeof x==='string') return ruleFn[x]?.()
    if(Array.isArray(x)){
      var fn = x.shift()
      return ruleFn[fn]?.(...x)
    }
    return x
  }) || []
  var ctx = path.join(__dirname, '../..')
  return {
    name: manifest.name,
    entry: path.join(dir, main || "./src/index"),
    mode: "development",
    devServer: dev,
    devtool: "source-map",
    stats: {
      errorDetails: true,
    },
    context: ctx, 
    output: {
      publicPath: publicPath || "auto",
      path: path.resolve(dir, dist),
    },
    experiments: {
      topLevelAwait: true
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          type: "javascript/auto",
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.jsx?$/,
          loader: use('babel-loader'),//path.join(ctx, "node_modules/babel-loader"),
          exclude: /node_modules/,
          options: {
            presets: [use('@babel/preset-react')],
            // context: ctx 
          },
        },
        ...rules
      ],
    },
    plugins: [
      new UiuxLoaderPlugin({
        manifest: rest
        , shared
      }),
      ...plugins
    ],
    manifest
  }
};
