declare module 'authenticate-pam' {
  type AuthenticateCallback = (error: Error | null, authenticated?: boolean) => void;

  export function authenticate(
    username: string,
    password: string,
    callback: AuthenticateCallback
  ): void;
}
