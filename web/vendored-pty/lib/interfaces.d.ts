/**
 * Copyright (c) 2016, Daniel Imms (MIT License).
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 */
export interface IProcessEnv {
    [key: string]: string | undefined;
}
import type { IExitEvent } from './types';
import type { IEvent } from './eventEmitter2';
export interface ITerminal {
    /**
     * Gets the name of the process.
     */
    process: string;
    /**
     * Gets the process ID.
     */
    pid: number;
    /**
     * The data event.
     */
    readonly onData: IEvent<string>;
    /**
     * The exit event.
     */
    readonly onExit: IEvent<IExitEvent>;
    /**
     * Writes data to the socket.
     * @param data The data to write.
     */
    write(data: string): void;
    /**
     * Resize the pty.
     * @param cols The number of columns.
     * @param rows The number of rows.
     */
    resize(cols: number, rows: number): void;
    /**
     * Clears the pty's internal representation of its buffer. This is a no-op
     * unless on Windows/ConPTY.
     */
    clear(): void;
    /**
     * Close, kill and destroy the socket.
     */
    destroy(): void;
    /**
     * Kill the pty.
     * @param signal The signal to send, by default this is SIGHUP. This is not
     * supported on Windows.
     */
    kill(signal?: string): void;
    /**
     * Set the pty socket encoding.
     */
    setEncoding(encoding: string | null): void;
    /**
     * Resume the pty socket.
     */
    resume(): void;
    /**
     * Pause the pty socket.
     */
    pause(): void;
    /**
     * Alias for ITerminal.on(eventName, listener).
     */
    addListener(eventName: string, listener: (...args: any[]) => any): void;
    /**
     * Adds the listener function to the end of the listeners array for the event
     * named eventName.
     * @param eventName The event name.
     * @param listener The callback function
     */
    on(eventName: string, listener: (...args: any[]) => any): void;
    /**
     * Returns a copy of the array of listeners for the event named eventName.
     */
    listeners(eventName: string): Function[];
    /**
     * Removes the specified listener from the listener array for the event named
     * eventName.
     */
    removeListener(eventName: string, listener: (...args: any[]) => any): void;
    /**
     * Removes all listeners, or those of the specified eventName.
     */
    removeAllListeners(eventName: string): void;
    /**
     * Adds a one time listener function for the event named eventName. The next
     * time eventName is triggered, this listener is removed and then invoked.
     */
    once(eventName: string, listener: (...args: any[]) => any): void;
}
interface IBasePtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: IProcessEnv;
    encoding?: string | null;
    handleFlowControl?: boolean;
    flowControlPause?: string;
    flowControlResume?: string;
}
export interface IPtyForkOptions extends IBasePtyForkOptions {
    uid?: number;
    gid?: number;
}
export interface IWindowsPtyForkOptions extends IBasePtyForkOptions {
    useConpty?: boolean;
    useConptyDll?: boolean;
    conptyInheritCursor?: boolean;
}
export interface IPtyOpenOptions {
    cols?: number;
    rows?: number;
    encoding?: string | null;
}
export {};
