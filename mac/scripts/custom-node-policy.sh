#!/bin/zsh

vibetunnel_is_truthy() {
    case "${1:l}" in
        1|true|yes|on)
            return 0
            ;;
    esac
    return 1
}

vibetunnel_custom_node_action() {
    local build_config="$1"
    local running_in_ci="$2"
    local require_custom_node="$3"
    local custom_node_path="$4"

    if [[ "$build_config" == "Release" ]] && vibetunnel_is_truthy "$require_custom_node"; then
        echo "prepare"
    elif [[ -f "$custom_node_path" ]]; then
        echo "use"
    elif [[ "$build_config" != "Release" ]]; then
        echo "system"
    elif ! vibetunnel_is_truthy "$running_in_ci"; then
        echo "prepare"
    else
        echo "system"
    fi
}
