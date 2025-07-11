"use strict";
/**
 * Copyright (c) 2019, Microsoft Corporation (MIT License).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventEmitter2 = void 0;
class EventEmitter2 {
    constructor() {
        this._listeners = [];
    }
    get event() {
        if (!this._event) {
            this._event = (listener) => {
                this._listeners.push(listener);
                const disposable = {
                    dispose: () => {
                        for (let i = 0; i < this._listeners.length; i++) {
                            if (this._listeners[i] === listener) {
                                this._listeners.splice(i, 1);
                                return;
                            }
                        }
                    }
                };
                return disposable;
            };
        }
        return this._event;
    }
    fire(data) {
        const queue = [];
        for (let i = 0; i < this._listeners.length; i++) {
            queue.push(this._listeners[i]);
        }
        for (let i = 0; i < queue.length; i++) {
            queue[i].call(undefined, data);
        }
    }
}
exports.EventEmitter2 = EventEmitter2;
