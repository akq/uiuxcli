function gitUrlToHttps(repoUrl) {
    var scp = /^git@([^:]+):(.+)$/.exec(repoUrl)
    var url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : repoUrl)
    if (!['ssh:', 'http:', 'https:'].includes(url.protocol)) {
        throw new Error('Unsupported Git URL protocol: ' + url.protocol)
    }
    return `https://${url.hostname}${url.port && url.protocol !== 'ssh:' ? ':' + url.port : ''}` +
        url.pathname.replace(/\/$/, '').replace(/\.git$/, '')
}

function getGitFileUrls(repoUrl, branch, filePath) {
    var base = gitUrlToHttps(repoUrl)
    var github = new URL(base).hostname === 'github.com'
    var prefix = github ? '' : '/-'
    var ref = branch.split('/').map(encodeURIComponent).join('/')
    var file = (filePath || '').replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '')
        .split('/').map(encodeURIComponent).join('/')
    return {
        branchUrl: `${base}${prefix}/tree/${ref}`,
        blobUrl: file ? `${base}${prefix}/blob/${ref}/${file}` : null,
        rawUrl: file ? `${base}${prefix}/raw/${ref}/${file}` : null,
    }
}

module.exports = { gitUrlToHttps, getGitFileUrls }
