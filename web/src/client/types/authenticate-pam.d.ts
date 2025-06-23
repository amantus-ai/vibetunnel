declare module 'authenticate-pam' {
  export function authenticate(
    username: string,
    password: string,
    callback: (err: Error | null) => void
  ): void;
}
