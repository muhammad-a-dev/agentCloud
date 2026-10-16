import { BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/types'

export function emit(e: AppEvent) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('app:event', e)
  }
}

export function toast(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  emit({ type: 'toast', level, message })
}
