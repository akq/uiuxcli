# uiuxcli
The command line of uiux

# Release Notes
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
