declare module 'bonjour-service' {
  export interface Service {
    start(): void;
    stop(callback?: () => void): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  }

  export interface PublishOptions {
    name: string;
    type: string;
    port: number;
    txt?: Record<string, string>;
  }

  export interface Bonjour {
    publish(options: PublishOptions): Service;
    unpublishAll(callback?: () => void): void;
    destroy(): void;
  }

  function bonjour(): Bonjour;
  export = bonjour;
}
