import { type DependencyList, useCallback, useEffect, useReducer } from 'react';

interface AsyncState<T> {
  status: 'idle' | 'pending' | 'success' | 'error';
  data?: T;
  error?: Error;
}

type AsyncAction<T> =
  | { type: 'RESET' }
  | { type: 'PENDING' }
  | { type: 'SUCCESS'; data: T }
  | { type: 'ERROR'; error: Error };

function asyncReducer<T>(state: AsyncState<T>, action: AsyncAction<T>): AsyncState<T> {
  switch (action.type) {
    case 'RESET':
      return { status: 'idle' };
    case 'PENDING':
      return { status: 'pending', data: state.data };
    case 'SUCCESS':
      return { status: 'success', data: action.data };
    case 'ERROR':
      return { status: 'error', error: action.error, data: state.data };
    default:
      return state;
  }
}

export function useAsync<T>() {
  const [state, dispatch] = useReducer(asyncReducer<T>, { status: 'idle' });

  const execute = useCallback(async (asyncFunction: () => Promise<T>) => {
    dispatch({ type: 'PENDING' });
    try {
      const data = await asyncFunction();
      dispatch({ type: 'SUCCESS', data });
      return data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      dispatch({ type: 'ERROR', error: err });
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  return {
    execute,
    reset,
    ...state,
    isIdle: state.status === 'idle',
    isLoading: state.status === 'pending',
    isSuccess: state.status === 'success',
    isError: state.status === 'error',
  };
}

// Specialized version for immediate execution
export function useAsyncEffect<T>(asyncFunction: () => Promise<T>, deps: DependencyList = []) {
  const async = useAsync<T>();

  useEffect(() => {
    async.execute(asyncFunction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [async.execute, asyncFunction, ...deps]);

  return async;
}
