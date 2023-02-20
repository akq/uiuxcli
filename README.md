# uiuxcli
The command line of uiux

# Release Notes
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
