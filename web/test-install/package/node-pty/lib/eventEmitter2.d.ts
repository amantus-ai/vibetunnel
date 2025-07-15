/**
 * Copyright (c) 2019, Microsoft Corporation (MIT License).
 */
import { IDisposable } from './types';
export interface IEvent<T> {
    (listener: (e: T) => any): IDisposable;
}
export declare class EventEmitter2<T> {
    private _listeners;
    private _event?;
    get event(): IEvent<T>;
    fire(data: T): void;
}
