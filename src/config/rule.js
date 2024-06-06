var path = require('path')

var exp = {}
// var ctx = (n) => path.join(__dirname, '../../node_modules', n)
var use = require.resolve//(n) => path.join(__dirname, '../../node_modules', n)
exp.css = (opt) => ({
    test: /\.css$/i,
    use: [use("style-loader"), use("css-loader")],
})
exp.less = (opt) => ({
    test: /\.less/i,
    use: [use("style-loader"), use("css-loader"), use('less-loader')]
})
exp.scss = (opt) => ({
    test: /\.scss/i,
    use: [use("style-loader"), use("css-loader"), use('sass-loader')]
})
exp.font = (opt)=>({
    test: /\.(woff|ttf|otf|eot|woff2|svg)$/,
    use: use('file-loader')
})
exp.image = (opt)=>({
    test: /\.(gif|jpg|png|jpeg|ico)$/,
    use: use('url-loader')
})
exp.pdf = (opt)=>({
    test: /\.pdf$/,
    use: use('url-loader')
})

//Arrow functions do not have their own arguments object. Thus, in this example, arguments is a reference to the arguments of the enclosing scope
exp.url = function(){
    var args = [...arguments], exts
    if(args.length > 1)
        exts = '('+args.join('|')+')'
    else exts = args[0]
    return {
        test: new RegExp('.'+exts+'$'),
        use: use('url-loader')
    }
}

exp.svg = (opt) => ({
    test: /\.svg$/,
    exclude: /node_modules/,
    use: [
        {
            loader: use('babel-loader'),
            options: {
                presets: [use('@babel/preset-react')],
                // context: ctx 
              }
        },
        {
            loader: use('react-svg-loader'),
            options: {
                svgo: {
                    plugins: [{ removeTitle: false }],
                    floatPrecision: 2
                },
                jsx: true
            }
        }
    ]
})
exp.ts = (opt) => ({ 
    test: /\.(ts|tsx)$/,
    exclude: /node_modules/, 
    use: "ts-loader"
    
})

module.exports = exp