# uiuxcli
The command line of uiux

# Release Notes
## 1.1.1
1. Add multi-branch builds with `--out`. Each branch gets its own output folder, with shared module references and a navigation page at the root.
2. Add `--serve <port>` to preview build output over HTTP.
3. Build the Webpack loader into the CLI and fix runtime generation during repeated builds.
4. Automatically rebuild modules after manifest or package configuration changes and refresh browsers after successful updates.
5. Serialize dev-server start/restart operations to avoid port conflicts.
6. Fix copying public assets from each module's own directory.
7. Support `build --target <folder>` for branch outputs without a navigation hub; `--branches` and `--excludes` also work without `--out`.
8. Fix debug-page actions and HTTPS source links for SSH Git remotes.

`build` without branch/output options still builds the current module.
Use `--target` for `<folder>/<branch>` outputs, or `--out` to also generate
shared references and the navigation page. These options cannot be combined.
Omitting `--mode` retains development mode; `--mode production` enables
production builds.

## 1.1.0
1. switch to @svgr/webpack
2. debug.html rewrite

## 1.0.14
1. if configured, the cli will not pull all branches from remote, but only from branches defined in uiDependenceis field 
2. support . if using the same branch 
3. remove the last parameter by default
4. default **start** parameter set to the **.** (current branch)
4. using name in package.json instead of branch name.

e.g. the previous command

```uiux dev --start demo/site --port 1235 --branches usr/tmpl_xyz ..```

suppose the current working diretory is **demo/site**, the branches dependencies are written in the uiDependencies field of **demo/site/package.json**, then it can be simplified to the following commands

```uiux dev --start . --port 1235 --branches + ```

```uiux dev --port 1235 --branches + ```

## 1.0.13
1. customize the rule block, use [] for the customization, 1st is the rule name, the rest is configuration
    ```js
    {
        ...
        rule: [
            ['url', 'pdf']
        ]
    }
    ```
1. add a pdf loader
    ```js
    {
        ...
        rule: ['pdf']
    }
    ```
1. debug page enhancement
1. upgrade the webpack version


## 1.0.12
1. add `use` option in `dev` command to use external ports as a dependency
    ```uiux dev --start path/branch --port 1235 --use 1233,1234 ..```
    
## 1.0.11
1. add more helper text for each option
1. add `ver` command to get current version of `uiuxcli`
1. upgrade `uiuxtest` and `uiuxloader` to latest version
1. add `excludes` option in `dev` command, add `port` option in `test` command
1. add the timer to monitor the cost when starting services in `debug.html`
1. fix some bugs.
## 1.0.10
1. add `mode` option for the command `build`. If ignored, it will use **development** mode

    production mode.

    ```uiux build --mode prod [source repo path]```

    development mode

    ```uiux build [source repo path]```

1. use the ports defined in domain.js if file exists for the `dev` command, rather than generate a new one.


## 1.0.9

add `proj` command

```uiux proj --add <proj name> [source repo path]```
