import { createContext, useContext } from 'react';

/** 全局轻提示（toast）上下文，由 AppShell 提供 */
export interface ToastApi {
  show: (message: string, tone?: 'info' | 'success' | 'warn') => void;
}

export const ToastContext = createContext<ToastApi>({ show: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
