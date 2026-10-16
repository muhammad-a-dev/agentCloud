import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { API_METHODS, type PreloadBridge } from '@shared/api'
import type { AppEvent } from '@shared/types'

const api: Record<string, unknown> = {}
for (const name of API_METHODS) {
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(`api:${name}`, ...args)
}
api.onEvent = (listener: (e: AppEvent) => void) => {
  const handler = (_: IpcRendererEvent, e: AppEvent) => listener(e)
  ipcRenderer.on('app:event', handler)
  return () => ipcRenderer.removeListener('app:event', handler)
}
api.getPathForFile = (file: File) => webUtils.getPathForFile(file)

contextBridge.exposeInMainWorld('agentCloud', api as unknown as PreloadBridge)
