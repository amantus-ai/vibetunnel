"use strict";
/**
 * Copyright (c) 2017, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign = assign;
function assign(target, ...sources) {
    sources.forEach(source => Object.keys(source).forEach(key => target[key] = source[key]));
    return target;
}
